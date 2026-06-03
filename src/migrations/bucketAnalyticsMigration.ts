import type { Database } from "bun:sqlite";
import type { Migration } from "./types";

/**
 * Migration to convert raw request_analytics to bucketed time-series tables.
 * This dramatically reduces storage and improves query performance.
 */
export const bucketAnalyticsMigration: Migration = {
	version: "0.4.0",
	description: "Convert to bucketed time-series analytics",

	async up(db: Database): Promise<void> {
		console.log("Running bucket analytics migration...");

		// Create 10-minute traffic table
		db.run(`
			CREATE TABLE IF NOT EXISTS traffic_10min (
				bucket INTEGER NOT NULL,
				endpoint TEXT NOT NULL,
				status_code INTEGER NOT NULL,
				hits INTEGER NOT NULL DEFAULT 1,
				total_response_time INTEGER NOT NULL DEFAULT 0,
				PRIMARY KEY (bucket, endpoint, status_code)
			) WITHOUT ROWID
		`);

		// Create hourly traffic table
		db.run(`
			CREATE TABLE IF NOT EXISTS traffic_hourly (
				bucket INTEGER NOT NULL,
				endpoint TEXT NOT NULL,
				status_code INTEGER NOT NULL,
				hits INTEGER NOT NULL DEFAULT 1,
				total_response_time INTEGER NOT NULL DEFAULT 0,
				PRIMARY KEY (bucket, endpoint, status_code)
			) WITHOUT ROWID
		`);

		// Create daily traffic table
		db.run(`
			CREATE TABLE IF NOT EXISTS traffic_daily (
				bucket INTEGER NOT NULL,
				endpoint TEXT NOT NULL,
				status_code INTEGER NOT NULL,
				hits INTEGER NOT NULL DEFAULT 1,
				total_response_time INTEGER NOT NULL DEFAULT 0,
				PRIMARY KEY (bucket, endpoint, status_code)
			) WITHOUT ROWID
		`);

		// Create user agent stats table
		db.run(`
			CREATE TABLE IF NOT EXISTS user_agent_stats (
				user_agent TEXT PRIMARY KEY,
				hits INTEGER NOT NULL DEFAULT 1,
				last_seen INTEGER NOT NULL
			) WITHOUT ROWID
		`);

		// Create indexes for time-range queries
		db.run(
			"CREATE INDEX IF NOT EXISTS idx_traffic_10min_bucket ON traffic_10min(bucket)",
		);
		db.run(
			"CREATE INDEX IF NOT EXISTS idx_traffic_hourly_bucket ON traffic_hourly(bucket)",
		);
		db.run(
			"CREATE INDEX IF NOT EXISTS idx_traffic_daily_bucket ON traffic_daily(bucket)",
		);
		db.run(
			"CREATE INDEX IF NOT EXISTS idx_user_agent_hits ON user_agent_stats(hits DESC)",
		);

		// Check if request_analytics table exists before attempting data migration
		const tableExists = db
			.query("SELECT name FROM sqlite_master WHERE type='table' AND name='request_analytics'")
			.get() as { name: string } | null;

		if (!tableExists) {
			console.log("No request_analytics table found, skipping data migration");
			console.log("Bucket analytics migration completed (schema only)");
			return;
		}

		console.log("Migrating existing analytics data to buckets...");

		// Compute cutoff once before processing to avoid drift across midnight
		const oneDayAgoSec = Math.floor(Date.now() / 1000) - 86400;

		// Prepare statements for bulk insert
		const insert10min = db.prepare(`
			INSERT INTO traffic_10min (bucket, endpoint, status_code, hits, total_response_time)
			VALUES (?1, ?2, ?3, 1, ?4)
			ON CONFLICT(bucket, endpoint, status_code) DO UPDATE SET 
				hits = hits + 1,
				total_response_time = total_response_time + ?4
		`);

		const insertHourly = db.prepare(`
			INSERT INTO traffic_hourly (bucket, endpoint, status_code, hits, total_response_time)
			VALUES (?1, ?2, ?3, 1, ?4)
			ON CONFLICT(bucket, endpoint, status_code) DO UPDATE SET 
				hits = hits + 1,
				total_response_time = total_response_time + ?4
		`);

		const insertDaily = db.prepare(`
			INSERT INTO traffic_daily (bucket, endpoint, status_code, hits, total_response_time)
			VALUES (?1, ?2, ?3, 1, ?4)
			ON CONFLICT(bucket, endpoint, status_code) DO UPDATE SET 
				hits = hits + 1,
				total_response_time = total_response_time + ?4
		`);

		const insertUserAgent = db.prepare(`
			INSERT INTO user_agent_stats (user_agent, hits, last_seen)
			VALUES (?1, 1, ?2)
			ON CONFLICT(user_agent) DO UPDATE SET 
				hits = hits + 1,
				last_seen = MAX(last_seen, ?2)
		`);

		// Paginate through data using rowid to avoid loading everything into memory
		const batchSize = 10000;
		let lastRowId = 0;
		let totalMigrated = 0;

		while (true) {
			const batch = db
				.query(
					`
				SELECT 
					rowid,
					endpoint,
					status_code,
					user_agent,
					timestamp,
					response_time
				FROM request_analytics
				WHERE rowid > ?
				ORDER BY rowid ASC
				LIMIT ?
			`,
				)
				.all(lastRowId, batchSize) as Array<{
				rowid: number;
				endpoint: string;
				status_code: number;
				user_agent: string | null;
				timestamp: number;
				response_time: number | null;
			}>;

			if (batch.length === 0) break;

			db.transaction(() => {
				for (const row of batch) {
					const timestampSec = Math.floor(row.timestamp / 1000);
					const bucket10min = timestampSec - (timestampSec % 600);
					const bucketHour = timestampSec - (timestampSec % 3600);
					const bucketDay = timestampSec - (timestampSec % 86400);
					const responseTime = row.response_time || 0;

					if (bucket10min >= oneDayAgoSec) {
						insert10min.run(
							bucket10min,
							row.endpoint,
							row.status_code,
							responseTime,
						);
					}

					insertHourly.run(
						bucketHour,
						row.endpoint,
						row.status_code,
						responseTime,
					);
					insertDaily.run(
						bucketDay,
						row.endpoint,
						row.status_code,
						responseTime,
					);

					if (row.user_agent) {
						insertUserAgent.run(row.user_agent, row.timestamp);
					}
				}
			})();

			lastRowId = batch[batch.length - 1].rowid;
			totalMigrated += batch.length;
			console.log(`Migrated ${totalMigrated} records...`);

			if (batch.length < batchSize) break;
		}

		console.log(`Total migrated: ${totalMigrated} records`);

		// Drop old table
		console.log("Dropping old request_analytics table...");
		db.run("DROP TABLE IF EXISTS request_analytics");

		console.log(
			"Bucket analytics migration completed (run VACUUM manually to reclaim space)",
		);
	},

	async down(db: Database): Promise<void> {
		db.run("DROP TABLE IF EXISTS traffic_10min");
		db.run("DROP TABLE IF EXISTS traffic_hourly");
		db.run("DROP TABLE IF EXISTS traffic_daily");
		db.run("DROP TABLE IF EXISTS user_agent_stats");
	},
};
