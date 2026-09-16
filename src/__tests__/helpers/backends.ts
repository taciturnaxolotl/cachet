/**
 * Shared backend selection and reset for the test suites.
 *
 * Both the integration suite and the parity suite need the same two things:
 * the list of backends worth exercising, and a way to return one to a known
 * empty state. Keeping that here means the destructive-operation guard has
 * exactly one home rather than one copy per suite.
 *
 * SQLite always runs. Postgres runs only when TEST_DATABASE_URL is set:
 *   TEST_DATABASE_URL=postgres://cachet:cachet@127.0.0.1:5432/cachet bun test
 */

import { unlinkSync } from "node:fs";
import { SQL } from "bun";
import type { DatabaseOptions } from "../../db";

export const PG_URL = process.env.TEST_DATABASE_URL;

/** Every table the app owns. */
export const TABLES = [
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

/**
 * Refuses to run destructive setup against anything that does not look like a
 * scratch database.
 *
 * These helpers drop every table they know about, so a mistyped
 * TEST_DATABASE_URL pointing at something real would be unrecoverable. Prose in
 * the README is the weakest possible enforcement; this is the check that
 * actually holds.
 */
export function assertScratchDatabase(url: string): void {
	const host = url.replace(/^[^@]*@/, "");
	const looksLocal =
		/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|db|postgres)[:/]/i.test(host);
	const looksScratch = /(test|scratch|ci|tmp)/i.test(url);
	if (!looksLocal && !looksScratch) {
		throw new Error(
			`Refusing to drop tables in "${host.split("/").pop()}": TEST_DATABASE_URL must point at a local or obviously disposable database.`,
		);
	}
}

/**
 * Drops every table so the backend starts with nothing at all.
 *
 * Dropping rather than truncating means `SlackCache.create()` exercises the
 * full schema bootstrap on each run, and it mirrors what deleting the SQLite
 * file does -- both backends genuinely start from zero.
 */
export async function resetPostgres(url: string): Promise<void> {
	assertScratchDatabase(url);
	const sql = new SQL({ url, max: 1 });
	try {
		for (const table of TABLES) {
			await sql.unsafe(`DROP TABLE IF EXISTS ${table} CASCADE`);
		}
	} finally {
		await sql.close();
	}
}

/** The SQLite equivalent of `resetPostgres`: no file means no tables. */
export function resetSqlite(path: string): void {
	try {
		unlinkSync(path);
	} catch {}
}

/** Returns a backend to a known-empty state, whichever kind it is. */
export async function resetBackend(options: DatabaseOptions): Promise<void> {
	if (options.url) await resetPostgres(options.url);
	if (options.path) resetSqlite(options.path);
}

/** The backends to run a suite against, given a SQLite path to scribble on. */
export function backendsFor(
	sqlitePath: string,
): Array<{ name: string; options: DatabaseOptions }> {
	const backends: Array<{ name: string; options: DatabaseOptions }> = [
		{ name: "sqlite", options: { path: sqlitePath } },
	];
	if (PG_URL) backends.push({ name: "postgres", options: { url: PG_URL } });
	return backends;
}
