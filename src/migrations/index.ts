import { endpointGroupingMigration } from "./endpointGroupingMigration";
import { Migration } from "./types";
import { MigrationManager } from "./migrationManager";

// Export all migrations
export const migrations: Migration[] = [
  endpointGroupingMigration,
  // Add new migrations here
];

// Export the migration manager and types
export { MigrationManager, Migration };