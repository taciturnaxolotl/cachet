import type { Database } from "bun:sqlite";
import type { Migration } from "./types";
import { normalizeEndpoint } from "./normalizeEndpoint";

/**
 * Migration to group request logs that aren't already grouped
 * This migration normalizes request_analytics data to use consistent endpoint grouping
 */
export const logGroupingMigration: Migration = {
	version: "0.3.2",
	description: "Group request logs that aren't already grouped",

	async up(db: Database): Promise<void> {
		console.log("Running log grouping migration...");

		// Check if request_analytics table exists (may have been dropped by later migration)
		const tableExists = db
			.query("SELECT name FROM sqlite_master WHERE type='table' AND name='request_analytics'")
			.get() as { name: string } | null;

		if (!tableExists) {
			console.log("request_analytics table not found, skipping log grouping migration");
			return;
		}

		const results = db
			.query(`
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
    `)
			.all() as Array<{ id: string; endpoint: string }>;

		console.log(`Found ${results.length} entries to check`);

		// Collect updates, then batch apply in a transaction
		const updates: Array<{ id: string; newEndpoint: string }> = [];
		for (const entry of results) {
			const newEndpoint = normalizeEndpoint(entry.endpoint);
			if (newEndpoint !== entry.endpoint) {
				updates.push({ id: entry.id, newEndpoint });
			}
		}

		if (updates.length > 0) {
			const stmt = db.prepare("UPDATE request_analytics SET endpoint = ? WHERE id = ?");
			db.transaction(() => {
				for (const update of updates) {
					stmt.run(update.newEndpoint, update.id);
				}
			})();
			console.log(`Updated ${updates.length} endpoints`);
		} else {
			console.log("No endpoints needed updating");
		}

		console.log("Log grouping migration completed");
	},
};
