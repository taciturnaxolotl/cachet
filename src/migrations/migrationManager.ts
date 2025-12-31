import type { Database } from "bun:sqlite";
import { version } from "../../package.json";

/**
 * Migration interface
 */
export interface Migration {
	version: string;
	description: string;
	up: (db: Database) => Promise<void>;
	down?: (db: Database) => Promise<void>; // Optional downgrade function
}

/**
 * Migration Manager for handling database schema and data migrations
 */
export class MigrationManager {
	private db: Database;
	private currentVersion: string;
	private migrations: Migration[];

	/**
	 * Creates a new MigrationManager
	 * @param db SQLite database instance
	 * @param migrations Array of migrations to apply
	 */
	constructor(db: Database, migrations: Migration[]) {
		this.db = db;
		this.currentVersion = version;
		this.migrations = migrations;
		this.initMigrationTable();
	}

	/**
	 * Initialize the migrations table if it doesn't exist
	 */
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

	/**
	 * Get the last applied migration version
	 * @returns The last applied migration version or null if no migrations have been applied
	 */
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

	/**
	 * Check if a migration has been applied
	 * @param version Migration version to check
	 * @returns True if the migration has been applied, false otherwise
	 */
	private isMigrationApplied(version: string): boolean {
		const result = this.db
			.query(`
      SELECT COUNT(*) as count FROM migrations 
      WHERE version = ?
    `)
			.get(version) as { count: number };

		return result.count > 0;
	}

	/**
	 * Record a migration as applied
	 * @param version Migration version
	 * @param description Migration description
	 */
	private recordMigration(version: string, description: string) {
		this.db.run(
			`
      INSERT INTO migrations (version, applied_at, description)
      VALUES (?, ?, ?)
    `,
			[version, Date.now(), description],
		);
	}

	/**
	 * Run migrations up to the current version
	 * @returns Object containing migration results
	 */
	async runMigrations(): Promise<{
		success: boolean;
		migrationsApplied: number;
		lastAppliedVersion: string | null;
		error?: string;
	}> {
		try {
			// Sort migrations by version (semver)
			const sortedMigrations = [...this.migrations].sort((a, b) => {
				return this.compareVersions(a.version, b.version);
			});

			const lastApplied = this.getLastAppliedMigration();
			let migrationsApplied = 0;
			let lastAppliedVersion = lastApplied?.version || null;

			console.log(`Current app version: ${this.currentVersion}`);
			console.log(`Last applied migration: ${lastAppliedVersion || "None"}`);

			// Special case for first run: if no migrations table exists yet,
			// assume we're upgrading from the previous version without migrations
			if (!lastAppliedVersion) {
				// Record a "virtual" migration for the previous version
				// This prevents all migrations from running on existing installations
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

			// Apply migrations that haven't been applied yet
			for (const migration of sortedMigrations) {
				// Skip if this migration has already been applied
				if (this.isMigrationApplied(migration.version)) {
					console.log(
						`Migration ${migration.version} already applied, skipping`,
					);
					continue;
				}

				// Skip if this migration is for a future version
				if (this.compareVersions(migration.version, this.currentVersion) > 0) {
					console.log(
						`Migration ${migration.version} is for a future version, skipping`,
					);
					continue;
				}

				// If we have a last applied migration, only apply migrations that are newer
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

				// Run the migration inside a transaction
				this.db.transaction(() => {
					// Apply the migration
					migration.up(this.db);

					// Record the migration
					this.recordMigration(migration.version, migration.description);
				})();

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

	/**
	 * Get the previous version from the current version
	 * @param version Current version
	 * @returns Previous version or null if can't determine
	 */
	private getPreviousVersion(version: string): string | null {
		const parts = version.split(".");
		if (parts.length !== 3) return null;

		const [major, minor, patch] = parts.map(Number);
		if (major === undefined || minor === undefined || patch === undefined) {
			return null;
		}

		// If patch > 0, decrement patch
		if (patch > 0) {
			return `${major}.${minor}.${patch - 1}`;
		}
		// If minor > 0, decrement minor and set patch to 0
		if (minor > 0) {
			return `${major}.${minor - 1}.0`;
		}
		// If major > 0, decrement major and set minor and patch to 0
		if (major > 0) {
			return `${major - 1}.0.0`;
		}

		return null;
	}

	/**
	 * Compare two version strings (semver)
	 * @param a First version
	 * @param b Second version
	 * @returns -1 if a < b, 0 if a = b, 1 if a > b
	 */
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
