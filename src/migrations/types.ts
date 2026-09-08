import type { Dialect, Queryable } from "../db/types";

/**
 * Migration interface
 */
export interface Migration {
	version: string;
	description: string;
	/**
	 * Backends this migration applies to. Omit for "all backends".
	 *
	 * The migrations shipped so far reshape data written by older SQLite-only
	 * releases, so they declare `["sqlite"]`: a fresh Postgres database is
	 * created by the current schema and has no legacy rows to fix up.
	 */
	dialects?: Dialect[];
	up: (db: Queryable) => Promise<void>;
	down?: (db: Queryable) => Promise<void>; // Optional downgrade function
}
