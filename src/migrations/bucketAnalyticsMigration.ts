import { greatest, tableExists } from "../db/dialect";
import { MAX_KEY_TEXT_LENGTH } from "../db/schema";
import type { Queryable } from "../db/types";
import type { Migration } from "./types";

const TRAFFIC_UPSERT = (table: string) => `
	INSERT INTO ${table} (bucket, endpoint, status_code, hits, total_response_time)
	VALUES (?1, ?2, ?3, 1, ?4)
	ON CONFLICT(bucket, endpoint, status_code) DO UPDATE SET
		hits = ${table}.hits + 1,
		total_response_time = ${table}.total_response_time + ?4
`;

/**
 * Clamps a value that is about to be used as part of a primary key.
 *
 * Endpoints and user agents in the legacy table were never length-checked, and
 * a Postgres btree entry has a hard size limit that would reject the row.
 */
function clampKey(value: string): string {
	return value.length > MAX_KEY_TEXT_LENGTH
		? value.slice(0, MAX_KEY_TEXT_LENGTH)
		: value;
}

/**
 * Migration to convert raw request_analytics rows into the bucketed
 * time-series tables, which is dramatically smaller and faster to query.
 *
 * This only moves data. The destination tables are created by `initSchema`,
 * which the cache always runs before `runMigrations` -- schema first, then
 * migrations. A migration must never redeclare a table the schema owns, or the
 * two definitions drift and whichever runs first wins.
 *
 * `request_analytics` is a legacy table that 0.3.x and earlier created and that
 * the current schema never creates, so on any database built by a recent
 * release this finds nothing and returns.
 */
export const bucketAnalyticsMigration: Migration = {
	version: "0.4.0",
	description: "Convert to bucketed time-series analytics",

	async up(db: Queryable): Promise<void> {
		console.log("Running bucket analytics migration...");

		if (!(await tableExists(db, "request_analytics"))) {
			console.log("No request_analytics table found, skipping data migration");
			return;
		}

		console.log("Migrating existing analytics data to buckets...");

		// Compute cutoff once before processing to avoid drift across midnight
		const oneDayAgoSec = Math.floor(Date.now() / 1000) - 86400;

		const upsert10min = TRAFFIC_UPSERT("traffic_10min");
		const upsertHourly = TRAFFIC_UPSERT("traffic_hourly");
		const upsertDaily = TRAFFIC_UPSERT("traffic_daily");
		const upsertUserAgent = `
			INSERT INTO user_agent_stats (user_agent, hits, last_seen)
			VALUES (?1, 1, ?2)
			ON CONFLICT(user_agent) DO UPDATE SET
				hits = user_agent_stats.hits + 1,
				last_seen = ${greatest(db.dialect, "user_agent_stats.last_seen", "?2")}
		`;

		// Paginate on the primary key to avoid loading everything into memory.
		// SQLite's `rowid` would be cheaper but does not exist on Postgres.
		const batchSize = 10000;
		let lastId = "";
		let totalMigrated = 0;

		while (true) {
			const batch = await db.all<{
				id: string;
				endpoint: string;
				status_code: number;
				user_agent: string | null;
				timestamp: number;
				response_time: number | null;
			}>(
				`
				SELECT
					id,
					endpoint,
					status_code,
					user_agent,
					timestamp,
					response_time
				FROM request_analytics
				WHERE id > ?
				ORDER BY id ASC
				LIMIT ?
			`,
				[lastId, batchSize],
			);

			const lastRow = batch.at(-1);
			if (!lastRow) break;

			for (const row of batch) {
				const timestampSec = Math.floor(row.timestamp / 1000);
				const bucket10min = timestampSec - (timestampSec % 600);
				const bucketHour = timestampSec - (timestampSec % 3600);
				const bucketDay = timestampSec - (timestampSec % 86400);
				const responseTime = row.response_time || 0;
				const endpoint = clampKey(row.endpoint);

				if (bucket10min >= oneDayAgoSec) {
					await db.run(upsert10min, [
						bucket10min,
						endpoint,
						row.status_code,
						responseTime,
					]);
				}

				await db.run(upsertHourly, [
					bucketHour,
					endpoint,
					row.status_code,
					responseTime,
				]);
				await db.run(upsertDaily, [
					bucketDay,
					endpoint,
					row.status_code,
					responseTime,
				]);

				if (row.user_agent) {
					await db.run(upsertUserAgent, [
						clampKey(row.user_agent),
						row.timestamp,
					]);
				}
			}

			lastId = lastRow.id;
			totalMigrated += batch.length;
			console.log(`Migrated ${totalMigrated} records...`);

			if (batch.length < batchSize) break;
		}

		console.log(`Total migrated: ${totalMigrated} records`);

		// Drop old table
		console.log("Dropping old request_analytics table...");
		await db.run("DROP TABLE IF EXISTS request_analytics");

		console.log(
			"Bucket analytics migration completed (run VACUUM manually to reclaim space)",
		);
	},
};
