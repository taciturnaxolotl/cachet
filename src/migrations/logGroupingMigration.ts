import { tableExists } from "../db/dialect";
import type { Queryable } from "../db/types";
import { normalizeEndpoint } from "./normalizeEndpoint";
import type { Migration } from "./types";

/**
 * Migration to group request logs that aren't already grouped
 * This migration normalizes request_analytics data to use consistent endpoint grouping
 *
 * `request_analytics` is a legacy table that 0.3.x and earlier created and that
 * the current schema never creates, so on any database built by a recent
 * release this finds nothing and returns.
 */
export const logGroupingMigration: Migration = {
	version: "0.3.2",
	description: "Group request logs that aren't already grouped",

	async up(db: Queryable): Promise<void> {
		console.log("Running log grouping migration...");

		// Check if request_analytics table exists (may have been dropped by later migration)
		if (!(await tableExists(db, "request_analytics"))) {
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
