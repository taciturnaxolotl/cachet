/**
 * Bun.sql (Postgres) driver -- an external database server.
 *
 * This is the backend to use when the app should not own a persistent volume:
 * state lives in Postgres, so the container is disposable and more than one
 * replica can run at once.
 */

import { SQL } from "bun";
import { toPostgresPlaceholders } from "./dialect";
import type { Db, Dialect, Queryable, RunResult } from "./types";

/** The subset of Bun's SQL client this driver uses. */
interface PostgresClient {
	unsafe(sql: string, params?: unknown[]): Promise<unknown>;
}

function bind(params: readonly unknown[]): unknown[] {
	return params.map((p) => (p === undefined ? null : p));
}

class PostgresQueryable implements Queryable {
	readonly dialect: Dialect = "postgres";

	constructor(protected readonly client: PostgresClient) {}

	private async exec(
		sql: string,
		params: readonly unknown[],
	): Promise<unknown[] & { count?: number }> {
		const result = await this.client.unsafe(
			toPostgresPlaceholders(sql),
			bind(params),
		);
		return result as unknown[] & { count?: number };
	}

	async all<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
		return (await this.exec(sql, params)) as T[];
	}

	async get<T>(
		sql: string,
		params: readonly unknown[] = [],
	): Promise<T | null> {
		const rows = (await this.exec(sql, params)) as T[];
		return rows[0] ?? null;
	}

	async run(sql: string, params: readonly unknown[] = []): Promise<RunResult> {
		const result = await this.exec(sql, params);
		// Bun reports affected rows on the result array; DDL reports none.
		return { changes: result.count ?? 0 };
	}
}

export class PostgresDb extends PostgresQueryable implements Db {
	private readonly sql: SQL;

	constructor(url: string, maxConnections: number) {
		const sql = new SQL({ url, max: maxConnections });
		super(sql as unknown as PostgresClient);
		this.sql = sql;
	}

	async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
		// Bun reserves one pooled connection for the callback and rolls back if
		// it throws. Statements must go through `tx` to land on that connection.
		return (await this.sql.begin(async (tx: unknown) =>
			fn(new PostgresQueryable(tx as PostgresClient)),
		)) as T;
	}

	async close(): Promise<void> {
		await this.sql.close();
	}
}
