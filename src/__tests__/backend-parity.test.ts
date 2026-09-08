/**
 * Asserts the SQLite and Postgres backends return identical results for the
 * same input.
 *
 * This suite exists because dialect bugs are silent rather than loud: an
 * unquoted camelCase alias folds to lowercase in Postgres, a BIGINT arrives as
 * a string, `MAX(a, b)` is not a scalar there. Every one of those produces a
 * plausible-looking wrong number instead of an error, so the only reliable
 * check is running both engines and diffing.
 *
 * Skipped unless TEST_DATABASE_URL names a Postgres database that is safe to
 * wipe:
 *   TEST_DATABASE_URL=postgres://cachet:cachet@127.0.0.1:5432/cachet bun test
 */

import { SQL } from "bun";
import { afterAll, describe, expect, it } from "bun:test";
import { unlinkSync } from "node:fs";
import { SlackCache } from "../cache";

const PG_URL = process.env.TEST_DATABASE_URL;
const SQLITE_PATH = "/tmp/cachet-parity-test.db";

/** Tables the app owns, in no particular order. */
const TABLES = [
	"users",
	"emojis",
	"traffic_10min",
	"traffic_hourly",
	"traffic_daily",
	"user_agent_stats",
	"referer_stats",
	"uptime_sessions",
	"migrations",
];

/** A fixed workload, so both backends see byte-identical input. */
const FIXTURE = [
	{
		endpoint: "/users/U123",
		status: 200,
		ua: "Mozilla/5.0",
		rt: 12.5,
		ref: "https://hackclub.com/page",
	},
	{
		endpoint: "/users/U123",
		status: 200,
		ua: "Mozilla/5.0",
		rt: 8.25,
		ref: "https://hackclub.com/other",
	},
	{
		endpoint: "/users/U999/r",
		status: 302,
		ua: "curl/8.1",
		rt: 3.5,
		ref: undefined,
	},
	{
		endpoint: "/emojis/parrot",
		status: 200,
		ua: "curl/8.1",
		rt: 1.75,
		ref: undefined,
	},
	{
		endpoint: "/emojis/parrot/r",
		status: 302,
		ua: "Slackbot 1.0",
		rt: 0.5,
		ref: undefined,
	},
	{
		endpoint: "/emojis",
		status: 200,
		ua: "Mozilla/5.0",
		rt: 44,
		ref: undefined,
	},
	{ endpoint: "/nope", status: 404, ua: "curl/8.1", rt: 0.25, ref: undefined },
	{ endpoint: "/nope", status: 500, ua: "curl/8.1", rt: 0.25, ref: undefined },
	// Oversized endpoint and user agent. Both end up in a primary key, and a
	// Postgres btree entry has a hard size limit, so these must be clamped.
	{
		endpoint: `/emojis/${"x".repeat(4000)}`,
		status: 200,
		ua: "A".repeat(9000),
		rt: 2,
		ref: undefined,
	},
];

async function truncatePostgres(url: string) {
	const sql = new SQL({ url, max: 1 });
	try {
		for (const table of TABLES) {
			await sql.unsafe(`TRUNCATE TABLE ${table}`);
		}
	} finally {
		await sql.close();
	}
}

/**
 * Runs the fixture against one backend and returns everything worth comparing.
 * Values that legitimately differ per process (wall-clock uptime, generated
 * UUIDs, absolute expiry timestamps) are reduced to backend-independent facts.
 */
async function run(options: { url?: string; path?: string }) {
	const cache = await SlackCache.create(options, 24);

	// Start from empty: the SQLite file is deleted by the caller, and an
	// external database keeps whatever the last run left behind.
	if (options.url) await truncatePostgres(options.url);

	await cache.insertUser(
		"U123",
		"Test",
		"Test Real",
		"he/him",
		"https://img/1",
	);
	await cache.insertEmoji("parrot", null, "https://img/parrot");
	await cache.batchInsertEmojis([
		{ name: "shark", imageUrl: "https://img/shark", alias: null },
		{ name: "shark2", imageUrl: "https://img/shark", alias: "shark" },
	]);

	for (const r of FIXTURE) {
		cache.recordRequest(r.endpoint, r.status, r.ua, r.rt, r.ref);
	}
	await cache.flushAnalytics();

	// Same key again, to prove the upsert accumulates rather than replaces.
	cache.recordRequest("/users/U123", 200, "Mozilla/5.0", 10, undefined);
	cache.recordRequest("/users/U123", 200, "Mozilla/5.0", 10, undefined);
	await cache.flushAnalytics();

	const user = await cache.getUser("U123");
	const emoji = await cache.getEmoji("parrot");
	const allEmojis = await cache.getAllEmojis();
	const analytics = await cache.getAnalytics(1);
	const essential = await cache.getEssentialStats(1);
	const charts = await cache.getChartData(1);
	const traffic = await cache.getTraffic({ days: 1 });
	const userAgents = await cache.getUserAgents();
	const uaCount = await cache.getUserAgentCount();
	const referers = await cache.getReferers();
	const health = await cache.detailedHealthCheck();
	const purgedUser = await cache.purgeUserCache("U123");
	const purgedEmojis = await cache.purgeEmojis();

	await cache.close();

	return {
		user: user && {
			userId: user.userId,
			displayName: user.displayName,
			realName: user.realName,
			pronouns: user.pronouns,
			imageUrl: user.imageUrl,
			// The exact timestamp differs per run; that it survived the round
			// trip as a real future date is the part that must match.
			expirationIsValidDate: !Number.isNaN(user.expiration.getTime()),
			expirationInFuture: user.expiration.getTime() > Date.now(),
		},
		emoji: emoji && {
			name: emoji.name,
			alias: emoji.alias,
			imageUrl: emoji.imageUrl,
		},
		emojiNames: allEmojis.map((e) => e.name).sort(),
		emojiAliases: allEmojis.map((e) => e.alias).sort(),
		totalRequests: analytics.totalRequests,
		requestsByEndpoint: analytics.requestsByEndpoint,
		requestsByStatus: analytics.requestsByStatus,
		requestsByDay: analytics.requestsByDay,
		averageResponseTime: analytics.averageResponseTime,
		topUserAgents: analytics.topUserAgents,
		errorRate: analytics.performanceMetrics.errorRate,
		throughput: analytics.performanceMetrics.throughput,
		cacheHitRate: analytics.performanceMetrics.cacheHitRate,
		peakTraffic: analytics.peakTraffic,
		trafficOverview: analytics.trafficOverview,
		slowestEndpoints: analytics.latencyAnalytics.slowestEndpoints,
		latencyOverTime: analytics.latencyAnalytics.latencyOverTime,
		dashboardMetrics: analytics.dashboardMetrics,
		essentialTotal: essential.totalRequests,
		essentialAvg: essential.averageResponseTime,
		charts,
		trafficHits: traffic.map((t) => t.hits),
		trafficLatency: traffic.map((t) => t.avgLatency),
		userAgents,
		uaCount,
		referers,
		databaseHealthy: health.checks.database.status,
		purgedUser,
		purgedEmojis,
	};
}

describe.skipIf(!PG_URL)("sqlite/postgres parity", () => {
	afterAll(() => {
		try {
			unlinkSync(SQLITE_PATH);
		} catch {}
	});

	it("returns identical results from both backends", async () => {
		try {
			unlinkSync(SQLITE_PATH);
		} catch {}

		const sqlite = await run({ path: SQLITE_PATH });
		const postgres = await run({ url: PG_URL });

		expect(postgres).toEqual(sqlite);
	}, 30000);

	it("stores fractional response times rather than rounding them", async () => {
		// A Postgres INTEGER column would silently round these to whole
		// milliseconds; the schema uses DOUBLE PRECISION there for that reason.
		const sqlite = await run({ path: SQLITE_PATH });
		expect(sqlite.averageResponseTime).not.toBeNull();
		expect(sqlite.averageResponseTime).not.toBe(
			Math.round(sqlite.averageResponseTime as number),
		);
	}, 30000);
});
