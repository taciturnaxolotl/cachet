import type { Database, Statement } from "bun:sqlite";

export const SECONDS_PER_10MIN = 600;
export const SECONDS_PER_HOUR = 3600;
export const SECONDS_PER_DAY = 86400;

const FLUSH_INTERVAL_MS = 50;
const MAX_PENDING_REQUESTS = 200;

/** Every bucket size divides the next, so each coarser row sums the finer ones. */
const TRAFFIC_TABLES = [
	["traffic_10min", SECONDS_PER_10MIN],
	["traffic_hourly", SECONDS_PER_HOUR],
	["traffic_daily", SECONDS_PER_DAY],
] as const;

interface TrafficRow {
	bucket: number;
	endpoint: string;
	statusCode: number;
	hits: number;
	totalResponseTime: number;
}

interface Counter {
	hits: number;
	lastSeen: number;
}

function addTraffic(
	rows: Map<string, TrafficRow>,
	bucket: number,
	endpoint: string,
	statusCode: number,
	hits: number,
	totalResponseTime: number,
): void {
	const key = `${bucket}\0${statusCode}\0${endpoint}`;
	const row = rows.get(key);
	if (row) {
		row.hits += hits;
		row.totalResponseTime += totalResponseTime;
	} else {
		rows.set(key, { bucket, endpoint, statusCode, hits, totalResponseTime });
	}
}

function rollUp(
	rows: Map<string, TrafficRow>,
	bucketSize: number,
): Map<string, TrafficRow> {
	const out = new Map<string, TrafficRow>();
	for (const r of rows.values()) {
		const bucket = r.bucket - (r.bucket % bucketSize);
		addTraffic(
			out,
			bucket,
			r.endpoint,
			r.statusCode,
			r.hits,
			r.totalResponseTime,
		);
	}
	return out;
}

function bumpCounter(
	counters: Map<string, Counter>,
	key: string,
	nowMs: number,
): void {
	const counter = counters.get(key);
	if (counter) {
		counter.hits++;
		if (nowMs > counter.lastSeen) counter.lastSeen = nowMs;
	} else {
		counters.set(key, { hits: 1, lastSeen: nowMs });
	}
}

/** Fast host extraction: skip "scheme://" then take until the next "/". */
function refererHost(referer: string): string | null {
	const i = referer.indexOf("://");
	if (i === -1) return null;
	const start = i + 3;
	const end = referer.indexOf("/", start);
	return end === -1 ? referer.substring(start) : referer.substring(start, end);
}

function prepareCounterUpsert(
	db: Database,
	table: string,
	column: string,
): Statement {
	return db.prepare(`
		INSERT INTO ${table} (${column}, hits, last_seen)
		VALUES (?1, ?3, ?2)
		ON CONFLICT(${column}) DO UPDATE SET
			hits = hits + ?3,
			last_seen = MAX(last_seen, ?2)
	`);
}

/**
 * Buffers request analytics in memory, merged by primary key, and writes them
 * in one transaction. Every table is an additive counter, so N requests that
 * share a key become one upsert of +N.
 */
export class AnalyticsWriter {
	private readonly db: Database;
	private readonly trafficStatements: ReadonlyArray<
		readonly [Statement, number]
	>;
	private readonly userAgentStatement: Statement;
	private readonly refererStatement: Statement;

	private traffic = new Map<string, TrafficRow>();
	private userAgents = new Map<string, Counter>();
	private referers = new Map<string, Counter>();
	private pendingRequests = 0;
	private flushTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(db: Database) {
		this.db = db;
		this.trafficStatements = TRAFFIC_TABLES.map(
			([table, bucketSize]) =>
				[
					db.prepare(`
						INSERT INTO ${table} (bucket, endpoint, status_code, hits, total_response_time)
						VALUES (?1, ?2, ?3, ?5, ?4)
						ON CONFLICT(bucket, endpoint, status_code) DO UPDATE SET
							hits = hits + ?5,
							total_response_time = total_response_time + ?4
					`),
					bucketSize,
				] as const,
		);
		this.userAgentStatement = prepareCounterUpsert(
			db,
			"user_agent_stats",
			"user_agent",
		);
		this.refererStatement = prepareCounterUpsert(
			db,
			"referer_stats",
			"referer_host",
		);
	}

	record(
		endpoint: string,
		statusCode: number,
		userAgent?: string,
		responseTime?: number,
		referer?: string,
	): void {
		const nowMs = Date.now();
		const now = Math.floor(nowMs / 1000);
		const bucket = now - (now % SECONDS_PER_10MIN);
		addTraffic(
			this.traffic,
			bucket,
			endpoint,
			statusCode,
			1,
			responseTime || 0,
		);

		if (userAgent) bumpCounter(this.userAgents, userAgent, nowMs);
		const host = referer ? refererHost(referer) : null;
		if (host !== null) bumpCounter(this.referers, host, nowMs);

		this.scheduleFlush(++this.pendingRequests >= MAX_PENDING_REQUESTS);
	}

	flush(): void {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
		if (this.pendingRequests === 0) return;

		const { traffic, userAgents, referers } = this;
		this.traffic = new Map();
		this.userAgents = new Map();
		this.referers = new Map();
		this.pendingRequests = 0;

		try {
			this.db.transaction(() => {
				for (const [statement, bucketSize] of this.trafficStatements) {
					for (const r of rollUp(traffic, bucketSize).values()) {
						statement.run(
							r.bucket,
							r.endpoint,
							r.statusCode,
							r.totalResponseTime,
							r.hits,
						);
					}
				}
				for (const [userAgent, c] of userAgents) {
					this.userAgentStatement.run(userAgent, c.lastSeen, c.hits);
				}
				for (const [host, c] of referers) {
					this.refererStatement.run(host, c.lastSeen, c.hits);
				}
			})();
		} catch (error) {
			console.error("Error flushing analytics write buffer:", error);
		}
	}

	/** A full buffer flushes on the next tick so it never blocks the response. */
	private scheduleFlush(full: boolean): void {
		if (this.flushTimer) return;
		this.flushTimer = setTimeout(
			() => this.flush(),
			full ? 0 : FLUSH_INTERVAL_MS,
		);
	}
}
