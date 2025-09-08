import { endpointGroupingMigration } from "./endpointGroupingMigration";
import { logGroupingMigration } from "./logGroupingMigration";
import { Migration } from "./types";

// Export all migrations
export const migrations = [
  endpointGroupingMigration,
  logGroupingMigration,
  // Add new migrations here
];

// Export the migration types
export { Migration };