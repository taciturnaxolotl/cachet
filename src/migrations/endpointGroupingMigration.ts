import { Database } from "bun:sqlite";
import { Migration } from "./types";

/**
 * Migration to fix endpoint grouping in analytics
 * This migration updates existing analytics data to use consistent endpoint grouping
 */
export const endpointGroupingMigration: Migration = {
  version: "0.3.1",
  description: "Fix endpoint grouping in analytics data",
  
  async up(db: Database): Promise<void> {
    console.log("Running endpoint grouping migration...");
    
    // Get all request_analytics entries with specific URLs
    const results = db.query(`
      SELECT id, endpoint FROM request_analytics 
      WHERE endpoint LIKE '/users/%' OR endpoint LIKE '/emojis/%'
    `).all() as Array<{ id: string; endpoint: string }>;
    
    console.log(`Found ${results.length} entries to update`);
    
    // Process each entry and update with the correct grouping
    for (const entry of results) {
      let newEndpoint = entry.endpoint;
      
      // Apply the same grouping logic we use in the analytics
      if (entry.endpoint.match(/^\/users\/[^\/]+$/)) {
        // Keep as is - these are already correctly grouped
        continue;
      } else if (entry.endpoint.match(/^\/users\/[^\/]+\/r$/)) {
        // Keep as is - these are already correctly grouped
        continue;
      } else if (entry.endpoint.match(/^\/emojis\/[^\/]+$/)) {
        // Keep as is - these are already correctly grouped
        continue;
      } else if (entry.endpoint.match(/^\/emojis\/[^\/]+\/r$/)) {
        // Keep as is - these are already correctly grouped
        continue;
      } else if (entry.endpoint.includes("/users/") && entry.endpoint.includes("/r")) {
        // This is a user redirect with a non-standard format
        newEndpoint = "/users/USER_ID/r";
      } else if (entry.endpoint.includes("/users/")) {
        // This is a user data endpoint with a non-standard format
        newEndpoint = "/users/USER_ID";
      } else if (entry.endpoint.includes("/emojis/") && entry.endpoint.includes("/r")) {
        // This is an emoji redirect with a non-standard format
        newEndpoint = "/emojis/EMOJI_NAME/r";
      } else if (entry.endpoint.includes("/emojis/")) {
        // This is an emoji data endpoint with a non-standard format
        newEndpoint = "/emojis/EMOJI_NAME";
      }
      
      // Only update if the endpoint has changed
      if (newEndpoint !== entry.endpoint) {
        db.run(`
          UPDATE request_analytics 
          SET endpoint = ? 
          WHERE id = ?
        `, [newEndpoint, entry.id]);
      }
    }
    
    console.log("Endpoint grouping migration completed");
  }
};