import type { Database } from "bun:sqlite";

/**
 * Migration interface
 */
export interface Migration {
	version: string;
	description: string;
	up: (db: Database) => Promise<void>;
	down?: (db: Database) => Promise<void>; // Optional downgrade function
}
