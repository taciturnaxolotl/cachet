import { tableExists } from "../db/dialect";
import type { Queryable } from "../db/types";
import { normalizeEndpoint } from "./normalizeEndpoint";
import type { Migration } from "./types";

/**
 * Migration to fix endpoint grouping in analytics
 * This migration updates existing analytics data to use consistent endpoint grouping
 *
 * `request_analytics` is a legacy table that 0.3.0 and earlier created and that
 * the current schema never creates, so on any database built by a recent
 * release this finds nothing and returns.
 */
export const endpointGroupingMigration: Migration = {
	version: "0.3.1",
	description: "Fix endpoint grouping in analytics data",

	async up(db: Queryable): Promise<void> {
		console.log("Running endpoint grouping migration...");

		// Check if request_analytics table exists (may have been dropped by later migration)
		if (!(await tableExists(db, "request_analytics"))) {
			console.log(
				"request_analytics table not found, skipping endpoint grouping migration",
			);
			return;
		}

		const results = await db.all<{ id: string; endpoint: string }>(`
      SELECT id, endpoint FROM request_analytics
      WHERE endpoint LIKE '/users/%' OR endpoint LIKE '/emojis/%'
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

		console.log("Endpoint grouping migration completed");
	},
};
