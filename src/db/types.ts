/**
 * Database driver abstraction.
 *
 * Cachet supports two backends behind one interface:
 *   - `sqlite`   -> bun:sqlite, a file on disk (or :memory:). Needs a persistent volume.
 *   - `postgres` -> Bun.sql, an external server. No volume, and safe for >1 replica.
 *
 * Callers write SQL once using `?` (or `?1`-style numbered) placeholders and
 * double-quoted camelCase identifiers; the postgres driver rewrites placeholders
 * to `$n`, and double-quoted identifiers keep their case in both engines.
 *
 * Dialect differences that SQL text cannot paper over (date formatting, N-ary
 * MAX, DDL types) live in `./dialect` and `./schema`.
 */

export type Dialect = "sqlite" | "postgres";

export interface RunResult {
	/** Rows affected by an INSERT/UPDATE/DELETE. */
	changes: number;
}

/**
 * The read/write surface. Both a pool and a single transaction implement this,
 * so query code is identical inside and outside a transaction.
 */
export interface Queryable {
	readonly dialect: Dialect;
	all<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
	get<T>(sql: string, params?: readonly unknown[]): Promise<T | null>;
	run(sql: string, params?: readonly unknown[]): Promise<RunResult>;
}

export interface Db extends Queryable {
	/**
	 * Runs `fn` inside a transaction, committing on return and rolling back on
	 * throw. The `tx` handle must be used for every statement in the body --
	 * using the outer `Db` would run outside the transaction on postgres.
	 */
	transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
	close(): Promise<void>;
}
