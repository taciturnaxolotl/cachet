/**
 * bun:sqlite driver -- a local database file (or `:memory:`).
 *
 * bun:sqlite is synchronous, so the async interface here is a thin wrapper. The
 * one piece of real machinery is the lock: because callers `await` between
 * statements, an unguarded `BEGIN ... COMMIT` could have unrelated queries
 * interleave into it from other microtasks. Serialising every operation makes
 * transactions actually atomic, and costs nothing given the underlying calls
 * never yield.
 */

import { Database, type SQLQueryBindings } from "bun:sqlite";
import type { Db, Dialect, Queryable, RunResult } from "./types";

/** bun:sqlite rejects `undefined` bindings; SQL NULL is what callers mean. */
function bind(params: readonly unknown[]): SQLQueryBindings[] {
	return params.map((p) => (p === undefined ? null : (p as SQLQueryBindings)));
}

class SqliteQueryable implements Queryable {
	readonly dialect: Dialect = "sqlite";

	constructor(protected readonly db: Database) {}

	protected allSync<T>(sql: string, params: readonly unknown[]): T[] {
		return this.db.query(sql).all(...bind(params)) as T[];
	}

	protected getSync<T>(sql: string, params: readonly unknown[]): T | null {
		return (this.db.query(sql).get(...bind(params)) as T | null) ?? null;
	}

	protected runSync(sql: string, params: readonly unknown[]): RunResult {
		const result = this.db.query(sql).run(...bind(params));
		return { changes: result.changes };
	}

	async all<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
		return this.allSync<T>(sql, params);
	}

	async get<T>(
		sql: string,
		params: readonly unknown[] = [],
	): Promise<T | null> {
		return this.getSync<T>(sql, params);
	}

	async run(sql: string, params: readonly unknown[] = []): Promise<RunResult> {
		return this.runSync(sql, params);
	}
}

export class SqliteDb extends SqliteQueryable implements Db {
	/** Tail of the operation queue; every op chains onto it. */
	private lock: Promise<unknown> = Promise.resolve();

	constructor(path: string) {
		super(new Database(path, { create: true }));
		this.applyPragmas();
	}

	private applyPragmas() {
		this.db.run("PRAGMA journal_mode = WAL");
		this.db.run("PRAGMA synchronous = NORMAL");
		this.db.run("PRAGMA cache_size = -64000");
		this.db.run("PRAGMA temp_store = MEMORY");
		this.db.run("PRAGMA mmap_size = 268435456");
		console.log("SQLite performance optimizations applied");
	}

	/** Runs `fn` once every previously queued operation has settled. */
	private serialize<T>(fn: () => T | Promise<T>): Promise<T> {
		const result = this.lock.then(fn, fn);
		// Swallow rejections on the chain itself so one failure doesn't reject
		// every later operation; the caller still sees its own error.
		this.lock = result.catch(() => {});
		return result;
	}

	override all<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
		return this.serialize(() => this.allSync<T>(sql, params));
	}

	override get<T>(
		sql: string,
		params: readonly unknown[] = [],
	): Promise<T | null> {
		return this.serialize(() => this.getSync<T>(sql, params));
	}

	override run(
		sql: string,
		params: readonly unknown[] = [],
	): Promise<RunResult> {
		return this.serialize(() => this.runSync(sql, params));
	}

	async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
		return this.serialize(async () => {
			// Inside the lock, so the body must bypass it or it would deadlock.
			const tx = new SqliteQueryable(this.db);
			this.db.run("BEGIN");
			try {
				const result = await fn(tx);
				this.db.run("COMMIT");
				return result;
			} catch (error) {
				try {
					this.db.run("ROLLBACK");
				} catch {
					// Already rolled back (e.g. a constraint aborted the statement).
				}
				throw error;
			}
		});
	}

	async close(): Promise<void> {
		await this.serialize(() => this.db.close());
	}
}
