/**
 * Backend selection and schema bootstrap.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PostgresDb } from "./postgres";
import { legacyColumnPatches, schemaStatements } from "./schema";
import { SqliteDb } from "./sqlite";
import type { Db, Dialect } from "./types";

export type { Db, Dialect, Queryable, RunResult } from "./types";
export { MAX_KEY_TEXT_LENGTH } from "./schema";

export interface DatabaseOptions {
	/** Connection string for an external database. Takes precedence when set. */
	url?: string | null;
	/** SQLite file path, used when no external URL is configured. */
	path?: string;
	/** Postgres pool size. Ignored by SQLite. */
	maxConnections?: number;
}

/** Recognises the connection strings that mean "use Postgres". */
export function dialectForUrl(url: string): Dialect | null {
	if (/^postgres(ql)?:\/\//i.test(url)) return "postgres";
	if (/^(sqlite|file):/i.test(url)) return "sqlite";
	return null;
}

/** Strips a `sqlite:`/`file:` scheme down to a plain filesystem path. */
function sqlitePathFromUrl(url: string): string {
	return url.replace(/^(sqlite|file):(\/\/)?/i, "") || ":memory:";
}

/**
 * Opens the configured database. Prefers `url` when present, otherwise falls
 * back to a local SQLite file at `path`.
 */
export function createDb(options: DatabaseOptions): Db {
	const { url, path, maxConnections = 10 } = options;

	if (!url && !path) {
		throw new Error("Either a database url or a SQLite path is required");
	}

	if (url) {
		const dialect = dialectForUrl(url);
		if (dialect === "postgres") {
			console.log("Using Postgres backend");
			return new PostgresDb(url, maxConnections);
		}
		if (dialect === "sqlite") {
			return openSqlite(sqlitePathFromUrl(url));
		}
		throw new Error(
			`Unsupported DATABASE_URL scheme: "${url.split(":")[0]}". Expected postgres://, sqlite: or file:`,
		);
	}

	return openSqlite(path as string);
}

function openSqlite(path: string): Db {
	if (path !== ":memory:") {
		// bun:sqlite creates the file but not the directory holding it.
		mkdirSync(dirname(path), { recursive: true });
	}
	console.log(`Using SQLite backend (${path})`);
	return new SqliteDb(path);
}

/**
 * Creates every table and index the app needs. Safe to call on an existing
 * database -- all statements are `IF NOT EXISTS`.
 */
export async function initSchema(db: Db): Promise<void> {
	for (const statement of schemaStatements(db.dialect)) {
		await db.run(statement);
	}

	for (const patch of legacyColumnPatches(db.dialect)) {
		try {
			await db.run(patch);
		} catch (error) {
			// Expected on any database that already has the column.
			const message = error instanceof Error ? error.message : String(error);
			if (!/duplicate column/i.test(message)) {
				console.error(`Failed to apply legacy column patch: ${patch}`, error);
			}
		}
	}
}
