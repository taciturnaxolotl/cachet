import type { Queryable } from "../db/types";
import { normalizeEndpoint } from "./normalizeEndpoint";
import type { Migration } from "./types";

/**
 * Migration to group request logs that aren't already grouped
 * This migration normalizes request_analytics data to use consistent endpoint grouping
 */
export const logGroupingMigration: Migration = {
	version: "0.3.2",
	description: "Group request logs that aren't already grouped",
	// Only ever relevant to a SQLite file written by 0.3.x or earlier.
	dialects: ["sqlite"],

	async up(db: Queryable): Promise<void> {
		console.log("Running log grouping migration...");

		// Check if request_analytics table exists (may have been dropped by later migration)
		const tableExists = await db.get<{ name: string }>(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='request_analytics'",
		);

		if (!tableExists) {
			console.log(
				"request_analytics table not found, skipping log grouping migration",
			);
			return;
		}

		const results = await db.all<{ id: string; endpoint: string }>(`
      SELECT id, endpoint FROM request_analytics
      WHERE
        endpoint NOT LIKE '/users/%/r' AND
        endpoint NOT LIKE '/users/%' AND
        endpoint NOT LIKE '/emojis/%/r' AND
        endpoint NOT LIKE '/emojis/%' AND
        endpoint NOT LIKE '/health' AND
        endpoint NOT LIKE '/dashboard' AND
        endpoint NOT LIKE '/swagger%' AND
        endpoint NOT LIKE '/reset' AND
        endpoint NOT LIKE '/stats' AND
        endpoint NOT LIKE '/'
    `);

		console.log(`Found ${results.length} entries to check`);

		// Collect updates, then apply them all (the migration runs in a transaction)
		const updates: Array<{ id: string; newEndpoint: string }> = [];
		for (const entry of results) {
			const newEndpoint = normalizeEndpoint(entry.endpoint);
			if (newEndpoint !== entry.endpoint) {
				updates.push({ id: entry.id, newEndpoint });
			}
		}

		if (updates.length > 0) {
			for (const update of updates) {
				await db.run("UPDATE request_analytics SET endpoint = ? WHERE id = ?", [
					update.newEndpoint,
					update.id,
				]);
			}
			console.log(`Updated ${updates.length} endpoints`);
		} else {
			console.log("No endpoints needed updating");
		}

		console.log("Log grouping migration completed");
	},
};
