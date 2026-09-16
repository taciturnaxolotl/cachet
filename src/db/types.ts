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

/**
 * Recognises the connection strings that mean "use Postgres", returning null
 * for anything unsupported.
 *
 * Lives here rather than in `./index` so that config validation can call it
 * without pulling both drivers -- and therefore `bun:sqlite` and Bun's SQL
 * client -- into the module graph.
 */
export function dialectForUrl(url: string): Dialect | null {
	if (/^postgres(ql)?:\/\//i.test(url)) return "postgres";
	if (/^(sqlite|file):/i.test(url)) return "sqlite";
	return null;
}

/** Single source of truth for the message both validation paths report. */
export function unsupportedUrlMessage(url: string): string {
	return `DATABASE_URL must start with postgres://, sqlite: or file:, got "${url.split(":")[0]}:"`;
}

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
