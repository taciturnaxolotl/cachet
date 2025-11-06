import type { Database } from "bun:sqlite";
import type { Migration } from "./types";

/**
 * Migration to group request logs that aren't already grouped
 * This migration normalizes request_analytics data to use consistent endpoint grouping
 */
export const logGroupingMigration: Migration = {
	version: "0.3.2",
	description: "Group request logs that aren't already grouped",

	async up(db: Database): Promise<void> {
		console.log("Running log grouping migration...");

		// Get all request_analytics entries with specific URLs that need grouping
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

		console.log(`Found ${results.length} entries to update`);

		// Process each entry and update with the correct grouping
		for (const entry of results) {
			let newEndpoint = entry.endpoint;

			// Apply grouping logic
			if (
				entry.endpoint.includes("localhost") ||
				entry.endpoint.includes("http")
			) {
				// Extract the path from URLs
				try {
					const url = new URL(entry.endpoint);
					newEndpoint = url.pathname;
				} catch (_e) {
					// If URL parsing fails, try to extract the path manually
					const pathMatch = entry.endpoint.match(/https?:\/\/[^/]+(\/.*)/);
					if (pathMatch?.[1]) {
						newEndpoint = pathMatch[1];
					}
				}
			}

			// Now apply the same grouping logic to the extracted path
			if (newEndpoint.match(/^\/users\/[^/]+$/)) {
				newEndpoint = "/users/USER_ID";
			} else if (newEndpoint.match(/^\/users\/[^/]+\/r$/)) {
				newEndpoint = "/users/USER_ID/r";
			} else if (newEndpoint.match(/^\/emojis\/[^/]+$/)) {
				newEndpoint = "/emojis/EMOJI_NAME";
			} else if (newEndpoint.match(/^\/emojis\/[^/]+\/r$/)) {
				newEndpoint = "/emojis/EMOJI_NAME/r";
			} else if (
				newEndpoint.includes("/users/") &&
				newEndpoint.includes("/r")
			) {
				newEndpoint = "/users/USER_ID/r";
			} else if (newEndpoint.includes("/users/")) {
				newEndpoint = "/users/USER_ID";
			} else if (
				newEndpoint.includes("/emojis/") &&
				newEndpoint.includes("/r")
			) {
				newEndpoint = "/emojis/EMOJI_NAME/r";
			} else if (newEndpoint.includes("/emojis/")) {
				newEndpoint = "/emojis/EMOJI_NAME";
			} else if (newEndpoint === "/") {
				newEndpoint = "/";
			} else if (newEndpoint === "/health") {
				newEndpoint = "/health";
			} else if (newEndpoint === "/dashboard") {
				newEndpoint = "/dashboard";
			} else if (newEndpoint.startsWith("/swagger")) {
				newEndpoint = "/swagger";
			} else if (newEndpoint === "/reset") {
				newEndpoint = "/reset";
			} else if (newEndpoint === "/stats") {
				newEndpoint = "/stats";
			} else {
				newEndpoint = "/other";
			}

			// Only update if the endpoint has changed
			if (newEndpoint !== entry.endpoint) {
				db.run(
					`
          UPDATE request_analytics 
          SET endpoint = ? 
          WHERE id = ?
        `,
					[newEndpoint, entry.id],
				);
			}
		}

		console.log("Log grouping migration completed");
	},
};
