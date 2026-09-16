import type { Queryable } from "../db/types";

/**
 * Migration interface
 *
 * Migrations run after `initSchema`, so every table the current schema declares
 * already exists. A migration's job is to reshape data left behind by an older
 * release, never to declare schema.
 *
 * Write the SQL so it runs on both backends. Where a migration only makes sense
 * for data an older release could have written, check for that data directly
 * (see `tableExists`) rather than branching on the backend: the check is the
 * honest question, and it stays true as the backends change.
 */
export interface Migration {
	version: string;
	description: string;
	up: (db: Queryable) => Promise<void>;
	down?: (db: Queryable) => Promise<void>; // Optional downgrade function
}
