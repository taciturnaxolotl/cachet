import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import { AnalyticsWriter } from "../lib/analytics-writer";

const SCHEMA = ["traffic_10min", "traffic_hourly", "traffic_daily"]
	.map(
		(t) => `CREATE TABLE ${t} (
			bucket INTEGER NOT NULL,
			endpoint TEXT NOT NULL,
			status_code INTEGER NOT NULL,
			hits INTEGER NOT NULL DEFAULT 1,
			total_response_time INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (bucket, endpoint, status_code)
		);`,
	)
	.concat(
		`CREATE TABLE user_agent_stats (user_agent TEXT PRIMARY KEY, hits INTEGER NOT NULL DEFAULT 1, last_seen INTEGER NOT NULL);`,
		`CREATE TABLE referer_stats (referer_host TEXT PRIMARY KEY, hits INTEGER NOT NULL DEFAULT 1, last_seen INTEGER NOT NULL);`,
	);

function freshDb(): Database {
	const db = new Database(":memory:");
	for (const ddl of SCHEMA) db.run(ddl);
	return db;
}

interface Req {
	nowMs: number;
	endpoint: string;
	status: number;
	ua?: string;
	respTime: number;
	referer?: string;
}

/** The pre-coalescing semantics: one +1 upsert per table per request. */
function referenceApply(db: Database, reqs: Req[]): void {
	const tables: [string, number][] = [
		["traffic_10min", 600],
		["traffic_hourly", 3600],
		["traffic_daily", 86400],
	];
	for (const r of reqs) {
		const now = Math.floor(r.nowMs / 1000);
		for (const [table, size] of tables) {
			db.run(
				`INSERT INTO ${table} (bucket, endpoint, status_code, hits, total_response_time)
				VALUES (?1, ?2, ?3, 1, ?4)
				ON CONFLICT(bucket, endpoint, status_code) DO UPDATE SET
					hits = hits + 1, total_response_time = total_response_time + ?4`,
				[now - (now % size), r.endpoint, r.status, r.respTime],
			);
		}
		if (r.ua) {
			db.run(
				`INSERT INTO user_agent_stats (user_agent, hits, last_seen) VALUES (?1, 1, ?2)
				ON CONFLICT(user_agent) DO UPDATE SET hits = hits + 1, last_seen = MAX(last_seen, ?2)`,
				[r.ua, r.nowMs],
			);
		}
		if (r.referer) {
			const i = r.referer.indexOf("://");
			if (i !== -1) {
				const start = i + 3;
				const end = r.referer.indexOf("/", start);
				const host =
					end === -1
						? r.referer.substring(start)
						: r.referer.substring(start, end);
				db.run(
					`INSERT INTO referer_stats (referer_host, hits, last_seen) VALUES (?1, 1, ?2)
					ON CONFLICT(referer_host) DO UPDATE SET hits = hits + 1, last_seen = MAX(last_seen, ?2)`,
					[host, r.nowMs],
				);
			}
		}
	}
}

function dump(db: Database) {
	const out: Record<string, unknown[]> = {};
	for (const t of ["traffic_10min", "traffic_hourly", "traffic_daily"]) {
		out[t] = db
			.query(`SELECT * FROM ${t} ORDER BY bucket, endpoint, status_code`)
			.all();
	}
	out.ua = db.query("SELECT * FROM user_agent_stats ORDER BY 1").all();
	out.ref = db.query("SELECT * FROM referer_stats ORDER BY 1").all();
	return out;
}

/** Small deterministic PRNG so failures reproduce from the seed. */
function mulberry32(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = seed;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function workload(seed: number, n: number): Req[] {
	const rand = mulberry32(seed);
	const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)] as T;
	// Start just before a UTC midnight so runs cross 10min, hour, and day edges
	let nowMs = Date.UTC(2026, 0, 1) - 3 * 60_000;
	const reqs: Req[] = [];
	for (let i = 0; i < n; i++) {
		nowMs += Math.floor(rand() * 4000);
		reqs.push({
			nowMs,
			endpoint: pick(["/users/U1", "/users/U2/r", "/emojis/x", "/stats"]),
			status: pick([200, 302, 404]),
			ua: pick([undefined, "curl/8", "Mozilla/5.0"]),
			respTime: Math.floor(rand() * 50),
			referer: pick([
				undefined,
				"https://a.com/x",
				"http://b.org",
				"garbage",
				"https://a.com",
			]),
		});
	}
	return reqs;
}

afterEach(() => {
	setSystemTime();
});

describe("analytics write coalescing", () => {
	it("matches per-request upserts across random workloads", () => {
		for (let seed = 1; seed <= 25; seed++) {
			const reqs = workload(seed, 400);
			const expected = freshDb();
			referenceApply(expected, reqs);

			const actual = freshDb();
			const writer = new AnalyticsWriter(actual);
			const rand = mulberry32(seed * 7919);
			for (const r of reqs) {
				setSystemTime(new Date(r.nowMs));
				writer.record(r.endpoint, r.status, r.ua, r.respTime, r.referer);
				// Flush at arbitrary points: result must not depend on batching
				if (rand() < 0.05) writer.flush();
			}
			writer.flush();

			expect(dump(actual)).toEqual(dump(expected));
		}
	});

	it("flushing an empty buffer writes nothing", () => {
		const db = freshDb();
		const writer = new AnalyticsWriter(db);
		writer.flush();
		expect(dump(db)).toEqual(dump(freshDb()));
	});
});
