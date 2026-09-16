import {
	asNumber,
	bucketToDate,
	bucketToDateTime,
	bucketToHour,
	greatest,
} from "../db/dialect";
import { MAX_KEY_TEXT_LENGTH } from "../db/schema";
import type { Db, Queryable } from "../db/types";
import type {
	ChartData,
	EssentialStatsData,
	FullAnalyticsData,
	UserAgentData,
} from "../types/analytics";
import { AnalyticsCache } from "../types/analytics";
import { groupEndpoint } from "./endpoint-names";

/**
 * The traffic rollups, coarsest last.
 *
 * Every request is counted into all three, and a read picks the coarsest table
 * that still has the resolution the range needs: `maxDays` is the longest range
 * that table serves. Adding a granularity here teaches the writer, the reader
 * and the table picker about it at once.
 */
export const TRAFFIC_TABLES = [
	{ table: "traffic_10min", seconds: 600, maxDays: 1 },
	{ table: "traffic_hourly", seconds: 3600, maxDays: 30 },
	{ table: "traffic_daily", seconds: 86400, maxDays: Number.POSITIVE_INFINITY },
] as const;

export type TrafficTable = (typeof TRAFFIC_TABLES)[number]["table"];

/** Builds one value per traffic table, keyed by table name. */
function byTrafficTable<T>(
	make: (spec: (typeof TRAFFIC_TABLES)[number]) => T,
): Record<TrafficTable, T> {
	return Object.fromEntries(
		TRAFFIC_TABLES.map((spec) => [spec.table, make(spec)]),
	) as Record<TrafficTable, T>;
}

/**
 * Selects the appropriate bucket table based on time range
 */
export function selectBucketTable(days: number): {
	table: TrafficTable;
	bucketSize: number;
} {
	// The last entry has an infinite range, so it also catches a NaN `days`.
	const spec =
		TRAFFIC_TABLES.find((t) => days <= t.maxDays) ?? TRAFFIC_TABLES[2];
	return { table: spec.table, bucketSize: spec.seconds };
}

/**
 * Resolves the query window for a time range: which bucket table to read, its
 * bucket size, and the oldest bucket to include.
 *
 * The cutoff is snapped down to a bucket boundary so the first bucket is either
 * wholly in or wholly out of the range. `from` overrides the default cutoff for
 * callers that already know their own start time.
 */
function resolveWindow(
	days: number,
	from?: number,
): { table: TrafficTable; bucketSize: number; alignedCutoff: number } {
	const { table, bucketSize } = selectBucketTable(days);
	const cutoff = from ?? Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
	return { table, bucketSize, alignedCutoff: cutoff - (cutoff % bucketSize) };
}

/** Mean of `total` over `n` samples, or 0 when there are no samples. */
const safeAvg = (total: number, n: number) => (n > 0 ? total / n : 0);

/**
 * Clamps a value that is about to be used as part of a primary key.
 *
 * Endpoints come from the request path and user agents straight from a header,
 * so both can be arbitrarily long. SQLite does not care, but a Postgres btree
 * entry has a hard size limit and would reject the row -- taking the whole
 * analytics batch down with it.
 */
function clampKey(value: string): string {
	return value.length > MAX_KEY_TEXT_LENGTH
		? value.slice(0, MAX_KEY_TEXT_LENGTH)
		: value;
}

/**
 * Rows per upsert statement.
 *
 * Postgres refuses a statement with more than 65535 bound parameters, and the
 * widest row here binds five, so 500 leaves an order of magnitude of headroom
 * while still collapsing a whole flush into a handful of round trips.
 */
const UPSERT_CHUNK_ROWS = 500;

/** `(?,?,?),(?,?,?)` -- one parenthesised group of `width` placeholders per row. */
function valuesPlaceholders(rows: number, width: number): string {
	const group = `(${Array.from({ length: width }, () => "?").join(",")})`;
	return Array.from({ length: rows }, () => group).join(",");
}

/** Splits `items` into runs of at most `size`. */
function chunked<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		out.push(items.slice(i, i + size));
	}
	return out;
}

interface BufferedRequest {
	/** The bucket this request falls in, per traffic table. */
	buckets: Record<TrafficTable, number>;
	endpoint: string;
	statusCode: number;
	respTime: number;
	userAgent: string | null;
	refererHost: string | null;
	nowMs: number;
}

/** One row's worth of accumulated traffic, keyed by bucket/endpoint/status. */
interface TrafficDelta {
	bucket: number;
	endpoint: string;
	statusCode: number;
	hits: number;
	totalResponseTime: number;
}

/** One row's worth of accumulated hits for a name/hits/last_seen table. */
interface CounterDelta {
	key: string;
	hits: number;
	lastSeen: number;
}

/**
 * Analytics query service - handles all analytics read/write operations
 */
export class AnalyticsQueryService {
	private db: Db;
	private typedAnalyticsCache: AnalyticsCache;

	// Write buffer for batched analytics recording
	private writeBuffer: BufferedRequest[] = [];
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	/** Tail of the flush chain, so overlapping flushes stay ordered. */
	private flushChain: Promise<void> = Promise.resolve();
	private readonly FLUSH_INTERVAL_MS = 50;
	private readonly MAX_BUFFER_SIZE = 200;

	/**
	 * Upsert builders, made once per instance because they embed dialect-specific
	 * SQL. Each takes the number of rows in the batch, since the statement grows
	 * a VALUES group per row.
	 */
	private readonly upsertTraffic: Record<
		TrafficTable,
		(rows: number) => string
	>;
	private readonly upsertUserAgent: (rows: number) => string;
	private readonly upsertReferer: (rows: number) => string;

	constructor(db: Db) {
		this.db = db;
		this.typedAnalyticsCache = new AnalyticsCache();

		this.upsertTraffic = byTrafficTable(
			({ table }) =>
				(rows: number) =>
					`
			INSERT INTO ${table} (bucket, endpoint, status_code, hits, total_response_time)
			VALUES ${valuesPlaceholders(rows, 5)}
			ON CONFLICT(bucket, endpoint, status_code) DO UPDATE SET
				hits = ${table}.hits + excluded.hits,
				total_response_time = ${table}.total_response_time + excluded.total_response_time
		`,
		);

		this.upsertUserAgent = (rows: number) => `
			INSERT INTO user_agent_stats (user_agent, hits, last_seen)
			VALUES ${valuesPlaceholders(rows, 3)}
			ON CONFLICT(user_agent) DO UPDATE SET
				hits = user_agent_stats.hits + excluded.hits,
				last_seen = ${greatest(db.dialect, "user_agent_stats.last_seen", "excluded.last_seen")}
		`;

		this.upsertReferer = (rows: number) => `
			INSERT INTO referer_stats (referer_host, hits, last_seen)
			VALUES ${valuesPlaceholders(rows, 3)}
			ON CONFLICT(referer_host) DO UPDATE SET
				hits = referer_stats.hits + excluded.hits,
				last_seen = ${greatest(db.dialect, "referer_stats.last_seen", "excluded.last_seen")}
		`;
	}

	/**
	 * Records a request by buffering it for batched writing.
	 * Entries are flushed every 50ms or when the buffer reaches MAX_BUFFER_SIZE.
	 */
	recordRequest(
		endpoint: string,
		statusCode: number,
		userAgent?: string,
		responseTime?: number,
		referer?: string,
	): void {
		const now = Math.floor(Date.now() / 1000);
		const buckets = byTrafficTable(({ seconds }) => now - (now % seconds));
		const respTime = responseTime || 0;
		const nowMs = Date.now();

		let refererHost: string | null = null;
		if (referer) {
			// Fast host extraction: skip "https://" then take until next "/"
			const i = referer.indexOf("://");
			if (i !== -1) {
				const start = i + 3;
				const end = referer.indexOf("/", start);
				refererHost =
					end === -1 ? referer.substring(start) : referer.substring(start, end);
			}
		}

		this.writeBuffer.push({
			buckets,
			endpoint: clampKey(endpoint),
			statusCode,
			respTime,
			userAgent: userAgent ? clampKey(userAgent) : null,
			refererHost: refererHost ? clampKey(refererHost) : null,
			nowMs,
		});

		if (this.writeBuffer.length >= this.MAX_BUFFER_SIZE) {
			// Defer flush so it doesn't block the current request's response
			if (!this.flushTimer) {
				this.flushTimer = setTimeout(() => {
					void this.flushWriteBuffer();
				}, 0);
			}
		} else if (!this.flushTimer) {
			this.flushTimer = setTimeout(() => {
				void this.flushWriteBuffer();
			}, this.FLUSH_INTERVAL_MS);
		}
	}

	/**
	 * Collapses buffered requests into one row per distinct key.
	 *
	 * A busy 200-entry buffer is mostly repeats of a handful of
	 * endpoint/status/bucket combinations, so this turns hundreds of statements
	 * into a few -- which is the difference between a viable and an unusable
	 * flush once the database is over a network.
	 */
	private aggregate(batch: BufferedRequest[]): {
		traffic: Record<TrafficTable, Map<string, TrafficDelta>>;
		userAgents: Map<string, CounterDelta>;
		referers: Map<string, CounterDelta>;
	} {
		const traffic = byTrafficTable(() => new Map<string, TrafficDelta>());
		const userAgents = new Map<string, CounterDelta>();
		const referers = new Map<string, CounterDelta>();

		const addTraffic = (
			table: TrafficTable,
			bucket: number,
			entry: BufferedRequest,
		) => {
			const map = traffic[table];
			const key = `${bucket}\u0000${entry.endpoint}\u0000${entry.statusCode}`;
			const existing = map.get(key);
			if (existing) {
				existing.hits += 1;
				existing.totalResponseTime += entry.respTime;
			} else {
				map.set(key, {
					bucket,
					endpoint: entry.endpoint,
					statusCode: entry.statusCode,
					hits: 1,
					totalResponseTime: entry.respTime,
				});
			}
		};

		const addCounter = (
			map: Map<string, CounterDelta>,
			key: string,
			lastSeen: number,
		) => {
			const existing = map.get(key);
			if (existing) {
				existing.hits += 1;
				existing.lastSeen = Math.max(existing.lastSeen, lastSeen);
			} else {
				map.set(key, { key, hits: 1, lastSeen });
			}
		};

		for (const entry of batch) {
			for (const { table } of TRAFFIC_TABLES) {
				addTraffic(table, entry.buckets[table], entry);
			}
			if (entry.userAgent) {
				addCounter(userAgents, entry.userAgent, entry.nowMs);
			}
			if (entry.refererHost) {
				addCounter(referers, entry.refererHost, entry.nowMs);
			}
		}

		return { traffic, userAgents, referers };
	}

	/**
	 * Writes the aggregated batch as one multi-row upsert per table, chunked so a
	 * statement never approaches the 65535 bound-parameter ceiling Postgres
	 * enforces. `aggregate` already made each conflict key unique within a batch,
	 * which is what lets several rows share one ON CONFLICT clause.
	 */
	private async writeBatch(tx: Queryable, batch: BufferedRequest[]) {
		const { traffic, userAgents, referers } = this.aggregate(batch);

		for (const { table } of TRAFFIC_TABLES) {
			const build = this.upsertTraffic[table];
			for (const rows of chunked(
				[...traffic[table].values()],
				UPSERT_CHUNK_ROWS,
			)) {
				await tx.run(
					build(rows.length),
					rows.flatMap((row) => [
						row.bucket,
						row.endpoint,
						row.statusCode,
						row.hits,
						row.totalResponseTime,
					]),
				);
			}
		}

		await this.writeCounters(tx, this.upsertUserAgent, userAgents);
		await this.writeCounters(tx, this.upsertReferer, referers);
	}

	/** Upserts a name/hits/last_seen table in multi-row chunks. */
	private async writeCounters(
		tx: Queryable,
		build: (rows: number) => string,
		counters: Map<string, CounterDelta>,
	) {
		for (const rows of chunked([...counters.values()], UPSERT_CHUNK_ROWS)) {
			await tx.run(
				build(rows.length),
				rows.flatMap((row) => [row.key, row.hits, row.lastSeen]),
			);
		}
	}

	/**
	 * Flushes the write buffer in a single transaction.
	 *
	 * Returns a promise that settles once this batch has been written; callers
	 * that need to read their own writes (the analytics endpoints, shutdown)
	 * should await it.
	 */
	flushWriteBuffer(): Promise<void> {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}

		if (this.writeBuffer.length === 0) return this.flushChain;

		const batch = this.writeBuffer;
		this.writeBuffer = [];

		this.flushChain = this.flushChain.then(async () => {
			try {
				await this.db.transaction((tx) => this.writeBatch(tx, batch));
			} catch (error) {
				console.error("Error flushing analytics write buffer:", error);
			}
		});

		return this.flushChain;
	}

	/**
	 * Gets request analytics statistics using bucketed time-series data
	 */
	async getAnalytics(
		days: number = 7,
		getUptime: () => Promise<number>,
	): Promise<FullAnalyticsData> {
		const cacheKey = `analytics_${days}`;
		const cached = this.typedAnalyticsCache.getAnalyticsData(cacheKey);
		if (cached) {
			return cached;
		}

		const { table, alignedCutoff } = resolveWindow(days);
		const dateTime = bucketToDateTime(this.db.dialect, "bucket");
		const hourExpr = bucketToHour(this.db.dialect, "bucket");
		const dayExpr = bucketToDate(this.db.dialect, "bucket");

		// None of these reads depends on another, and uptime does not touch these
		// tables at all, so they go out together instead of costing a round trip
		// each. Everything below stays in its original order.
		const [
			totalResult,
			statsResult,
			rawEndpointResults,
			statusResultsRaw,
			timeResultsRaw,
			avgResponseResult,
			topUserAgents,
			uptime,
			peakHourData,
			peakDayData,
			trafficRaw,
		] = await Promise.all([
			this.db.get<{ count: number | null }>(
				`SELECT ${asNumber("SUM(hits)")} as count FROM ${table} WHERE bucket >= ? AND endpoint != '/stats'`,
				[alignedCutoff],
			),

			this.db.get<{ count: number | null }>(
				`SELECT ${asNumber("SUM(hits)")} as count FROM ${table} WHERE bucket >= ? AND endpoint = '/stats'`,
				[alignedCutoff],
			),

			this.db.all<{
				endpoint: string;
				count: number;
				totalTime: number;
			}>(
				`
         SELECT endpoint,
           ${asNumber("SUM(hits)")} as count,
           ${asNumber("SUM(total_response_time)")} as "totalTime"
         FROM ${table}
         WHERE bucket >= ? AND endpoint != '/stats'
         GROUP BY endpoint
         ORDER BY count DESC, endpoint ASC
       `,
				[alignedCutoff],
			),

			this.db.all<{
				status: number;
				count: number;
				totalTime: number;
			}>(
				`
         SELECT ${asNumber("status_code")} as status,
           ${asNumber("SUM(hits)")} as count,
           ${asNumber("SUM(total_response_time)")} as "totalTime"
         FROM ${table}
         WHERE bucket >= ? AND endpoint != '/stats'
         GROUP BY status_code
         ORDER BY count DESC, status_code ASC
       `,
				[alignedCutoff],
			),

			this.db.all<{
				date: string;
				count: number;
				totalTime: number;
			}>(
				`
         SELECT
           ${dateTime} as date,
           ${asNumber("SUM(hits)")} as count,
           ${asNumber("SUM(total_response_time)")} as "totalTime"
         FROM ${table}
         WHERE bucket >= ? AND endpoint != '/stats'
         GROUP BY bucket
         ORDER BY bucket ASC
       `,
				[alignedCutoff],
			),

			this.db.get<{
				totalTime: number | null;
				totalHits: number | null;
			}>(
				`
         SELECT ${asNumber("SUM(total_response_time)")} as "totalTime",
                ${asNumber("SUM(hits)")} as "totalHits"
         FROM ${table}
         WHERE bucket >= ? AND endpoint != '/stats'
       `,
				[alignedCutoff],
			),

			this.db.all<{
				userAgent: string;
				hits: number;
			}>(
				`
         SELECT user_agent as "userAgent", ${asNumber("hits")} as hits
         FROM user_agent_stats
         WHERE user_agent IS NOT NULL
         ORDER BY hits DESC, user_agent ASC
         LIMIT 50
       `,
			),

			getUptime(),

			this.db.get<{ hour: string; count: number }>(
				`
         SELECT
           ${hourExpr} as hour,
           ${asNumber("SUM(hits)")} as count
         FROM ${table}
         WHERE bucket >= ? AND endpoint != '/stats'
         GROUP BY ${hourExpr}
         ORDER BY count DESC, hour ASC
         LIMIT 1
       `,
				[alignedCutoff],
			),

			this.db.get<{ day: string; count: number }>(
				`
         SELECT
           ${dayExpr} as day,
           ${asNumber("SUM(hits)")} as count
         FROM ${table}
         WHERE bucket >= ? AND endpoint != '/stats'
         GROUP BY ${dayExpr}
         ORDER BY count DESC, day ASC
         LIMIT 1
       `,
				[alignedCutoff],
			),

			this.db.all<{
				time: string;
				endpoint: string;
				count: number;
			}>(
				`
         SELECT
           ${dateTime} as time,
           endpoint,
           ${asNumber("SUM(hits)")} as count
         FROM ${table}
         WHERE bucket >= ? AND endpoint != '/stats'
         GROUP BY bucket, endpoint
         ORDER BY bucket ASC, endpoint ASC
       `,
				[alignedCutoff],
			),
		]);

		const endpointGroups: Record<
			string,
			{ count: number; totalResponseTime: number; requestCount: number }
		> = {};

		for (const result of rawEndpointResults) {
			const groupKey = groupEndpoint(result.endpoint);

			if (!endpointGroups[groupKey]) {
				endpointGroups[groupKey] = {
					count: 0,
					totalResponseTime: 0,
					requestCount: 0,
				};
			}

			const group = endpointGroups[groupKey];
			if (group) {
				group.count += result.count;
				if (result.totalTime && result.count > 0) {
					group.totalResponseTime += result.totalTime;
					group.requestCount += result.count;
				}
			}
		}

		const requestsByEndpoint = Object.entries(endpointGroups)
			.map(([endpoint, data]) => ({
				endpoint,
				count: data.count,
				averageResponseTime: safeAvg(data.totalResponseTime, data.requestCount),
			}))
			.sort((a, b) => b.count - a.count);

		const statusResults = statusResultsRaw.map((s) => ({
			status: s.status,
			count: s.count,
			averageResponseTime: safeAvg(s.totalTime, s.count),
		}));

		const timeResults = timeResultsRaw.map((r) => ({
			date: r.date,
			count: r.count,
			averageResponseTime: safeAvg(r.totalTime, r.count),
		}));

		const avgResponseHits = avgResponseResult?.totalHits ?? 0;
		const averageResponseTime =
			avgResponseHits > 0
				? safeAvg(avgResponseResult?.totalTime ?? 0, avgResponseHits)
				: null;

		const percentiles = {
			p50: null as number | null,
			p75: null as number | null,
			p90: null as number | null,
			p95: null as number | null,
			p99: null as number | null,
		};

		const distribution: Array<{
			range: string;
			count: number;
			percentage: number;
		}> = [];

		const slowestEndpoints = requestsByEndpoint
			.filter((e) => e.averageResponseTime > 0)
			.sort((a, b) => b.averageResponseTime - a.averageResponseTime)
			.slice(0, 10);

		// Same table, window and grouping as `timeResults`, so it is derived here
		// rather than fetched a second time.
		const latencyOverTime = timeResults.map((r) => ({
			time: r.date,
			averageResponseTime: r.averageResponseTime,
			p95: null as number | null,
			count: r.count,
		}));

		const totalCount = totalResult?.count ?? 0;
		const errorRequests = statusResults
			.filter((s) => s.status >= 400)
			.reduce((sum, s) => sum + s.count, 0);
		const errorRate = totalCount > 0 ? (errorRequests / totalCount) * 100 : 0;

		const timeSpanHours = days * 24;
		const throughput = totalCount / timeSpanHours;

		const apdex = 0;

		const redirectRequests = requestsByEndpoint
			.filter(
				(e) =>
					e.endpoint === "User Redirects" || e.endpoint === "Emoji Redirects",
			)
			.reduce((sum, e) => sum + e.count, 0);
		const dataRequests = requestsByEndpoint
			.filter((e) => e.endpoint === "User Data" || e.endpoint === "Emoji Data")
			.reduce((sum, e) => sum + e.count, 0);
		const cacheHitRate =
			redirectRequests + dataRequests > 0
				? (redirectRequests / (redirectRequests + dataRequests)) * 100
				: 0;

		const timeGroups: Record<string, Record<string, number>> = {};
		for (const row of trafficRaw) {
			if (!timeGroups[row.time]) {
				timeGroups[row.time] = {};
			}

			const groupKey = groupEndpoint(row.endpoint);
			const group = timeGroups[row.time];

			if (group) {
				group[groupKey] = (group[groupKey] || 0) + row.count;
			}
		}

		const trafficOverview = Object.entries(timeGroups)
			.map(([time, routes]) => ({
				time,
				routes,
				total: Object.values(routes).reduce((sum, count) => sum + count, 0),
			}))
			.sort((a, b) => a.time.localeCompare(b.time));

		const result: FullAnalyticsData = {
			totalRequests: totalCount,
			requestsByEndpoint: requestsByEndpoint,
			requestsByStatus: statusResults,
			requestsByDay: timeResults,
			averageResponseTime: averageResponseTime,
			topUserAgents: topUserAgents,
			latencyAnalytics: {
				percentiles,
				distribution,
				slowestEndpoints,
				latencyOverTime,
			},
			performanceMetrics: {
				uptime,
				errorRate,
				throughput,
				apdex,
				cacheHitRate,
			},
			peakTraffic: {
				peakHour: peakHourData?.hour || "N/A",
				peakRequests: peakHourData?.count || 0,
				peakDay: peakDayData?.day || "N/A",
				peakDayRequests: peakDayData?.count || 0,
			},
			dashboardMetrics: {
				statsRequests: statsResult?.count ?? 0,
				totalWithStats: totalCount + (statsResult?.count ?? 0),
			},
			trafficOverview,
		};

		this.typedAnalyticsCache.setAnalyticsData(cacheKey, result);

		return result;
	}

	/**
	 * Gets essential stats only (fast loading)
	 */
	async getEssentialStats(
		days: number = 7,
		getUptime: () => Promise<number>,
	): Promise<EssentialStatsData> {
		const cacheKey = `essential_${days}`;
		const cached = this.typedAnalyticsCache.getEssentialStatsData(cacheKey);

		if (cached) {
			return cached;
		}

		const { table, alignedCutoff } = resolveWindow(days);

		// Independent reads, issued together.
		const [totalResult, avgResponseResult, uptime] = await Promise.all([
			this.db.get<{ count: number | null }>(
				`SELECT ${asNumber("SUM(hits)")} as count FROM ${table} WHERE bucket >= ? AND endpoint != '/stats'`,
				[alignedCutoff],
			),

			this.db.get<{
				totalTime: number | null;
				totalHits: number | null;
			}>(
				`SELECT ${asNumber("SUM(total_response_time)")} as "totalTime", ${asNumber("SUM(hits)")} as "totalHits" FROM ${table} WHERE bucket >= ? AND endpoint != '/stats' AND total_response_time > 0`,
				[alignedCutoff],
			),

			getUptime(),
		]);

		const totalCount = totalResult?.count ?? 0;
		const avgResponseHits = avgResponseResult?.totalHits ?? 0;
		const result: EssentialStatsData = {
			totalRequests: totalCount,
			averageResponseTime:
				avgResponseHits > 0
					? safeAvg(avgResponseResult?.totalTime ?? 0, avgResponseHits)
					: null,
			uptime,
		};

		this.typedAnalyticsCache.setEssentialStatsData(cacheKey, result);

		return result;
	}

	/**
	 * Gets chart data only (requests and latency over time)
	 */
	async getChartData(days: number = 7): Promise<ChartData> {
		const cacheKey = `charts_${days}`;
		const cached = this.typedAnalyticsCache.getChartData(cacheKey);

		if (cached) {
			return cached;
		}

		const { table, alignedCutoff } = resolveWindow(days);

		const timeResultsRaw = await this.db.all<{
			date: string;
			count: number;
			totalTime: number;
		}>(
			`
         SELECT
           ${bucketToDateTime(this.db.dialect, "bucket")} as date,
           ${asNumber("SUM(hits)")} as count,
           ${asNumber("SUM(total_response_time)")} as "totalTime"
         FROM ${table}
         WHERE bucket >= ? AND endpoint != '/stats'
         GROUP BY bucket
         ORDER BY bucket ASC
       `,
			[alignedCutoff],
		);

		const requestsByDay = timeResultsRaw.map((r) => ({
			date: r.date,
			count: r.count,
			averageResponseTime: safeAvg(r.totalTime, r.count),
		}));

		const latencyOverTime = timeResultsRaw.map((r) => ({
			time: r.date,
			averageResponseTime: safeAvg(r.totalTime, r.count),
			p95: null as number | null,
			count: r.count,
		}));

		const result: ChartData = {
			requestsByDay,
			latencyOverTime,
		};

		this.typedAnalyticsCache.setChartData(cacheKey, result);

		return result;
	}

	/**
	 * Gets traffic data for charts with adaptive granularity
	 */
	async getTraffic(
		options: { days?: number; startTime?: number; endTime?: number } = {},
	): Promise<
		Array<{ bucket: number; hits: number; avgLatency: number | null }>
	> {
		const now = Math.floor(Date.now() / 1000);
		let start: number;
		let end: number;

		if (options.startTime && options.endTime) {
			start = options.startTime;
			end = options.endTime;
		} else {
			const days = options.days || 7;
			start = now - days * 24 * 60 * 60;
			end = now;
		}

		const spanDays = (end - start) / 86400;
		const { table, alignedCutoff: alignedStart } = resolveWindow(
			spanDays,
			start,
		);

		const results = await this.db.all<{
			bucket: number;
			hits: number;
			totalTime: number;
			hitsWithTime: number;
		}>(
			`
				SELECT
					${asNumber("bucket")} as bucket,
					${asNumber("SUM(hits)")} as hits,
					${asNumber("SUM(CASE WHEN total_response_time > 0 THEN total_response_time ELSE 0 END)")} as "totalTime",
					${asNumber("SUM(CASE WHEN total_response_time > 0 THEN hits ELSE 0 END)")} as "hitsWithTime"
				FROM ${table}
				WHERE bucket >= ? AND bucket <= ? AND endpoint != '/stats'
				GROUP BY bucket
				ORDER BY bucket ASC
			`,
			[alignedStart, end],
		);

		return results.map((r) => ({
			bucket: r.bucket,
			hits: r.hits,
			avgLatency: r.hitsWithTime > 0 ? r.totalTime / r.hitsWithTime : null,
		}));
	}

	/**
	 * Gets user agents data from cumulative stats table
	 */
	async getUserAgents(): Promise<UserAgentData> {
		const cacheKey = "useragents_all";
		const cached = this.typedAnalyticsCache.getUserAgentData(cacheKey);

		if (cached) {
			return cached;
		}

		const topUserAgents = await this.db.all<{
			userAgent: string;
			hits: number;
		}>(
			`
         SELECT user_agent as "userAgent", ${asNumber("hits")} as hits
         FROM user_agent_stats
         WHERE user_agent IS NOT NULL
         ORDER BY hits DESC, user_agent ASC
         LIMIT 50
       `,
		);

		this.typedAnalyticsCache.setUserAgentData(cacheKey, topUserAgents);

		return topUserAgents;
	}

	/**
	 * Gets total count of unique user agents
	 */
	async getUserAgentCount(): Promise<number> {
		const result = await this.db.get<{ count: number }>(
			`SELECT ${asNumber("COUNT(*)")} as count FROM user_agent_stats WHERE user_agent IS NOT NULL`,
		);
		return result?.count || 0;
	}

	/**
	 * Gets referer stats from cumulative stats table
	 */
	async getReferers(): Promise<Array<{ refererHost: string; hits: number }>> {
		return this.db.all<{ refererHost: string; hits: number }>(
			`
				SELECT referer_host as "refererHost", ${asNumber("hits")} as hits
				FROM referer_stats
				WHERE referer_host IS NOT NULL
				AND referer_host NOT LIKE 'localhost%'
				AND referer_host NOT LIKE '127.0.0.1%'
				AND referer_host NOT LIKE '::1%'
				ORDER BY hits DESC, referer_host ASC
				LIMIT 50
				`,
		);
	}
}
