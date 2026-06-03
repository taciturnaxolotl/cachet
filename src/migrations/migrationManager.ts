import type { Database } from "bun:sqlite";
import { version } from "../../package.json";
import type { Migration } from "./types";

/**
 * Migration Manager for handling database schema and data migrations
 */
export class MigrationManager {
	private db: Database;
	private currentVersion: string;
	private migrations: Migration[];

	constructor(db: Database, migrations: Migration[]) {
		this.db = db;
		this.currentVersion = version;
		this.migrations = migrations;
		this.initMigrationTable();
	}

	private initMigrationTable() {
		this.db.run(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version TEXT NOT NULL,
        applied_at INTEGER NOT NULL,
        description TEXT
      )
    `);
	}

	private getLastAppliedMigration(): {
		version: string;
		applied_at: number;
	} | null {
		const result = this.db
			.query(`
      SELECT version, applied_at FROM migrations 
      ORDER BY applied_at DESC LIMIT 1
    `)
			.get() as { version: string; applied_at: number } | null;

		return result;
	}

	private isMigrationApplied(version: string): boolean {
		const result = this.db
			.query(`
      SELECT COUNT(*) as count FROM migrations 
      WHERE version = ?
    `)
			.get(version) as { count: number };

		return result.count > 0;
	}

	private recordMigration(version: string, description: string) {
		this.db.run(
			`
      INSERT INTO migrations (version, applied_at, description)
      VALUES (?, ?, ?)
    `,
			[version, Date.now(), description],
		);
	}

	async runMigrations(): Promise<{
		success: boolean;
		migrationsApplied: number;
		lastAppliedVersion: string | null;
		error?: string;
	}> {
		try {
			const sortedMigrations = [...this.migrations].sort((a, b) => {
				return this.compareVersions(a.version, b.version);
			});

			const lastApplied = this.getLastAppliedMigration();
			let migrationsApplied = 0;
			let lastAppliedVersion = lastApplied?.version || null;

			console.log(`Current app version: ${this.currentVersion}`);
			console.log(`Last applied migration: ${lastAppliedVersion || "None"}`);

			if (!lastAppliedVersion) {
				const previousVersion = this.getPreviousVersion(this.currentVersion);
				if (previousVersion) {
					console.log(
						`No migrations table found. Assuming upgrade from ${previousVersion}`,
					);
					this.recordMigration(
						previousVersion,
						"Virtual migration for existing installation",
					);
					lastAppliedVersion = previousVersion;
				}
			}

			for (const migration of sortedMigrations) {
				if (this.isMigrationApplied(migration.version)) {
					console.log(
						`Migration ${migration.version} already applied, skipping`,
					);
					continue;
				}

				if (this.compareVersions(migration.version, this.currentVersion) > 0) {
					console.log(
						`Migration ${migration.version} is for a future version, skipping`,
					);
					continue;
				}

				if (
					lastAppliedVersion &&
					this.compareVersions(migration.version, lastAppliedVersion) <= 0
				) {
					console.log(
						`Migration ${migration.version} is older than last applied (${lastAppliedVersion}), skipping`,
					);
					continue;
				}

				console.log(
					`Applying migration ${migration.version}: ${migration.description}`,
				);

				try {
					this.db.run("BEGIN");
					await migration.up(this.db);
					this.recordMigration(migration.version, migration.description);
					this.db.run("COMMIT");
				} catch (migrationError) {
					this.db.run("ROLLBACK");
					throw new Error(
						`Migration ${migration.version} failed: ${migrationError instanceof Error ? migrationError.message : String(migrationError)}`,
					);
				}

				migrationsApplied++;
				lastAppliedVersion = migration.version;
				console.log(`Migration ${migration.version} applied successfully`);
			}

			return {
				success: true,
				migrationsApplied,
				lastAppliedVersion,
			};
		} catch (error) {
			console.error("Error running migrations:", error);
			return {
				success: false,
				migrationsApplied: 0,
				lastAppliedVersion: null,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	private getPreviousVersion(version: string): string | null {
		const parts = version.split(".");
		if (parts.length !== 3) return null;

		const [major, minor, patch] = parts.map(Number);
		if (major === undefined || minor === undefined || patch === undefined) {
			return null;
		}

		if (patch > 0) {
			return `${major}.${minor}.${patch - 1}`;
		}
		if (minor > 0) {
			return `${major}.${minor - 1}.0`;
		}
		if (major > 0) {
			return `${major - 1}.0.0`;
		}

		return null;
	}

	private compareVersions(a: string, b: string): number {
		const partsA = a.split(".").map(Number);
		const partsB = b.split(".").map(Number);

		for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
			const partA = partsA[i] ?? 0;
			const partB = partsB[i] ?? 0;

			if (partA < partB) return -1;
			if (partA > partB) return 1;
		}

		return 0;
	}
}
