import type { Database } from "bun:sqlite";
import type { Migration } from "./types";
import { normalizeEndpoint } from "./normalizeEndpoint";

/**
 * Migration to fix endpoint grouping in analytics
 * This migration updates existing analytics data to use consistent endpoint grouping
 */
export const endpointGroupingMigration: Migration = {
	version: "0.3.1",
	description: "Fix endpoint grouping in analytics data",

	async up(db: Database): Promise<void> {
		console.log("Running endpoint grouping migration...");

		// Check if request_analytics table exists (may have been dropped by later migration)
		const tableExists = db
			.query(
				"SELECT name FROM sqlite_master WHERE type='table' AND name='request_analytics'",
			)
			.get() as { name: string } | null;

		if (!tableExists) {
			console.log(
				"request_analytics table not found, skipping endpoint grouping migration",
			);
			return;
		}

		const results = db
			.query(`
      SELECT id, endpoint FROM request_analytics 
      WHERE endpoint LIKE '/users/%' OR endpoint LIKE '/emojis/%'
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
			const stmt = db.prepare(
				"UPDATE request_analytics SET endpoint = ? WHERE id = ?",
			);
			db.transaction(() => {
				for (const update of updates) {
					stmt.run(update.newEndpoint, update.id);
				}
			})();
			console.log(`Updated ${updates.length} endpoints`);
		} else {
			console.log("No endpoints needed updating");
		}

		console.log("Endpoint grouping migration completed");
	},
};
