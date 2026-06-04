import { Database } from "bun:sqlite";
import { schedule, type ScheduledTask } from "node-cron";
import { bucketAnalyticsMigration } from "./migrations/bucketAnalyticsMigration";
import { endpointGroupingMigration } from "./migrations/endpointGroupingMigration";
import { logGroupingMigration } from "./migrations/logGroupingMigration";
import { MigrationManager } from "./migrations/migrationManager";
import type { SlackUserProvider, User, Emoji } from "./types/cache-entities";
import type { FullAnalyticsData, EssentialStatsData, ChartData } from "./types/analytics";
import { AnalyticsQueryService } from "./lib/analytics-queries";
import { HealthMonitor } from "./lib/health-monitor";

// Re-export types for backward compatibility
export type { SlackUserProvider, User, Emoji } from "./types/cache-entities";
export type {
	FullAnalyticsData,
	EssentialStatsData,
	ChartData,
	UserAgentData,
	EndpointMetrics,
	StatusMetrics,
	DayMetrics,
	UserAgentMetrics,
	LatencyPercentiles,
	LatencyDistribution,
	LatencyOverTimeMetrics,
	LatencyAnalytics,
	PerformanceMetrics,
	PeakTraffic,
	DashboardMetrics,
	TrafficOverview,
} from "./types/analytics";


const SECONDS_PER_10MIN = 600;
const SECONDS_PER_DAY = 86400;
const MS_PER_HOUR = 3600000;
const USER_DEFAULT_TTL_HOURS = 7 * 24;
const USER_CLEANUP_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const TOUCH_REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const QUEUE_BATCH_SIZE = 3;
const QUEUE_INTERVAL_MS = 30 * 1000;

/**
 * Cache class for storing user and emoji data with automatic expiration.
 * Composes AnalyticsQueryService and HealthMonitor for separation of concerns.
 */
class Cache {
	private db: Database;
	private defaultExpiration: number; // in hours
	private onEmojiExpired?: () => void;

	// Background user update queue to avoid Slack API limits
	private userUpdateQueue: Set<string> = new Set();
	private isProcessingQueue = false;
	private slackWrapper?: SlackUserProvider;

	// Composed services
	private analytics: AnalyticsQueryService;
	private healthMonitor: HealthMonitor;

	// Scheduled task handles for cleanup
	private cronTasks: ScheduledTask[] = [];
	private queueIntervalId?: ReturnType<typeof setInterval>;

	// Prepared statements for cache lookups
	private stmtGetUser!: import("bun:sqlite").Statement;
	private stmtGetEmoji!: import("bun:sqlite").Statement;

	constructor(
		dbPath: string,
		defaultExpirationHours = 24,
		onEmojiExpired?: () => void,
	) {
		this.db = new Database(dbPath);
		this.defaultExpiration = defaultExpirationHours;
		this.onEmojiExpired = onEmojiExpired;

		this.optimizeSQLite();
		this.initDatabase();

		this.analytics = new AnalyticsQueryService(this.db);
		this.healthMonitor = new HealthMonitor(
			this.db,
			() => this.userUpdateQueue.size,
		);

		this.initPreparedStatements();
		this.healthMonitor.startUptimeSession();
		this.setupPurgeSchedule();
		this.startQueueProcessor();

		this.runMigrations();
	}

	private optimizeSQLite() {
		this.db.run("PRAGMA journal_mode = WAL");
		this.db.run("PRAGMA synchronous = NORMAL");
		this.db.run("PRAGMA cache_size = -64000");
		this.db.run("PRAGMA temp_store = MEMORY");
		this.db.run("PRAGMA mmap_size = 268435456");
		console.log("SQLite performance optimizations applied");
	}

	private initPreparedStatements() {
		this.stmtGetUser = this.db.prepare("SELECT * FROM users WHERE userId = ?");
		this.stmtGetEmoji = this.db.prepare(
			"SELECT * FROM emojis WHERE name = ? AND expiration > ?",
		);
	}

	private initDatabase() {
		this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        userId TEXT UNIQUE,
        displayName TEXT,
        pronouns TEXT,
        imageUrl TEXT,
        expiration INTEGER
      )
    `);

		this.db.run(`
      CREATE TABLE IF NOT EXISTS emojis (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE,
        alias TEXT,
        imageUrl TEXT,
        expiration INTEGER
      )
    `);

		this.db.run(`
			CREATE TABLE IF NOT EXISTS traffic_10min (
				bucket INTEGER NOT NULL,
				endpoint TEXT NOT NULL,
				status_code INTEGER NOT NULL,
				hits INTEGER NOT NULL DEFAULT 1,
				total_response_time INTEGER NOT NULL DEFAULT 0,
				PRIMARY KEY (bucket, endpoint, status_code)
			) WITHOUT ROWID
		`);

		this.db.run(`
			CREATE TABLE IF NOT EXISTS traffic_hourly (
				bucket INTEGER NOT NULL,
				endpoint TEXT NOT NULL,
				status_code INTEGER NOT NULL,
				hits INTEGER NOT NULL DEFAULT 1,
				total_response_time INTEGER NOT NULL DEFAULT 0,
				PRIMARY KEY (bucket, endpoint, status_code)
			) WITHOUT ROWID
		`);

		this.db.run(`
			CREATE TABLE IF NOT EXISTS traffic_daily (
				bucket INTEGER NOT NULL,
				endpoint TEXT NOT NULL,
				status_code INTEGER NOT NULL,
				hits INTEGER NOT NULL DEFAULT 1,
				total_response_time INTEGER NOT NULL DEFAULT 0,
				PRIMARY KEY (bucket, endpoint, status_code)
			) WITHOUT ROWID
		`);

		this.db.run(`
			CREATE TABLE IF NOT EXISTS user_agent_stats (
				user_agent TEXT PRIMARY KEY,
				hits INTEGER NOT NULL DEFAULT 1,
				last_seen INTEGER NOT NULL
			) WITHOUT ROWID
		`);

		this.db.run(`
			CREATE TABLE IF NOT EXISTS referer_stats (
				referer_host TEXT PRIMARY KEY,
				hits INTEGER NOT NULL DEFAULT 1,
				last_seen INTEGER NOT NULL
			) WITHOUT ROWID
		`);

		this.db.run(`
			CREATE TABLE IF NOT EXISTS uptime_sessions (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				start_time INTEGER NOT NULL,
				end_time INTEGER,
				duration INTEGER
			)
		`);

		this.db.run(
			"CREATE INDEX IF NOT EXISTS idx_traffic_10min_bucket ON traffic_10min(bucket)",
		);
		this.db.run(
			"CREATE INDEX IF NOT EXISTS idx_traffic_hourly_bucket ON traffic_hourly(bucket)",
		);
		this.db.run(
			"CREATE INDEX IF NOT EXISTS idx_traffic_daily_bucket ON traffic_daily(bucket)",
		);
		this.db.run(
			"CREATE INDEX IF NOT EXISTS idx_user_agent_hits ON user_agent_stats(hits DESC)",
		);
		this.db.run(
			"CREATE INDEX IF NOT EXISTS idx_referer_hits ON referer_stats(hits DESC)",
		);

		if (this.onEmojiExpired) {
			const result = this.db
				.query("SELECT COUNT(*) as count FROM emojis WHERE expiration > ?")
				.get(Date.now()) as { count: number };
			if (result.count === 0) {
				this.onEmojiExpired();
			}
		}

	}

	private setupPurgeSchedule() {
		const cronOptions = { timezone: "Etc/UTC" };

		this.cronTasks.push(schedule("45 * * * *", async () => {
			try {
				await this.purgeExpiredItems();
				await this.lazyUserCleanup();
			} catch (error) {
				console.error("Error during purge schedule:", error);
			}
		}, cronOptions));

		this.cronTasks.push(schedule("0 * * * *", async () => {
			try {
				console.log("Scheduled emoji update starting...");
				if (this.onEmojiExpired) {
					await this.onEmojiExpired();
					console.log("Scheduled emoji update completed");
				}
			} catch (error) {
				console.error("Error during emoji update schedule:", error);
			}
		}, cronOptions));

		this.cronTasks.push(schedule("0 8 * * *", () => {
			try {
				console.log("Running scheduled VACUUM...");
				this.db.run("VACUUM");
				console.log("VACUUM completed");
			} catch (error) {
				console.error("Error during VACUUM:", error);
			}
		}, cronOptions));
	}

	private async runMigrations() {
		try {
			const migrations = [
				endpointGroupingMigration,
				logGroupingMigration,
				bucketAnalyticsMigration,
			];
			const migrationManager = new MigrationManager(this.db, migrations);
			const result = await migrationManager.runMigrations();

			if (result.migrationsApplied > 0) {
				console.log(
					`Applied ${result.migrationsApplied} migrations. Latest version: ${result.lastAppliedVersion}`,
				);
			} else {
				console.log("No new migrations to apply");
			}
		} catch (error) {
			console.error("Error running migrations:", error);
		}
	}

	async purgeExpiredItems(): Promise<number> {
		const result2 = this.db.run("DELETE FROM emojis WHERE expiration < ?", [
			Date.now(),
		]);

		const oneDayAgoSec = Math.floor(Date.now() / 1000) - SECONDS_PER_DAY;
		const cleanupBucket = oneDayAgoSec - (oneDayAgoSec % SECONDS_PER_10MIN);
		this.db.run("DELETE FROM traffic_10min WHERE bucket < ?", [cleanupBucket]);

		return result2.changes;
	}

	private async lazyUserCleanup(): Promise<void> {
		const currentHour = new Date().getUTCHours();
		if (currentHour >= 8 && currentHour < 10 && Math.random() < 0.1) {
			const sevenDaysAgo = Date.now() - USER_CLEANUP_AGE_MS;
			const result = this.db.run("DELETE FROM users WHERE expiration < ?", [
				sevenDaysAgo,
			]);
			if (result.changes > 0) {
				console.log(
					`Lazy user cleanup: removed ${result.changes} expired users`,
				);
			}
		}
	}

	async purgeUserCache(userId: string): Promise<boolean> {
		try {
			const result = this.db.run("DELETE FROM users WHERE userId = ?", [
				userId.toUpperCase(),
			]);
			return result.changes > 0;
		} catch (error) {
			console.error("Error purging user cache:", error);
			return false;
		}
	}

	async purgeAll(): Promise<{
		message: string;
		users: number;
		emojis: number;
	}> {
		const result = this.db.run("DELETE FROM users");
		const result2 = this.db.run("DELETE FROM emojis");

		if (this.onEmojiExpired) {
			if (result2.changes > 0) {
				this.onEmojiExpired();
			}
		}

		return {
			message: "Cache purged",
			users: result.changes,
			emojis: result2.changes,
		};
	}

	// --- Delegated health/uptime methods ---

	async healthCheck(): Promise<boolean> {
		return this.healthMonitor.healthCheck();
	}

	async detailedHealthCheck() {
		return this.healthMonitor.detailedHealthCheck();
	}

	endUptimeSession() {
		this.healthMonitor.endUptimeSession();
	}

	getUptime(): number {
		return this.healthMonitor.getUptime();
	}

	// --- Slack wrapper injection ---

	setSlackWrapper(slackWrapper: SlackUserProvider) {
		this.slackWrapper = slackWrapper;
		this.healthMonitor.setSlackWrapper(slackWrapper);
	}

	// --- User update queue ---

	queueUserUpdate(userId: string) {
		this.userUpdateQueue.add(userId.toUpperCase());
	}

	private startQueueProcessor() {
		this.queueIntervalId = setInterval(async () => {
			await this.processUserUpdateQueue();
		}, QUEUE_INTERVAL_MS);
	}

	private flushTouchRefresh(newExpiration: number, normalizedId: string) {
		queueMicrotask(() => {
			try {
				this.db.run("UPDATE users SET expiration = ? WHERE userId = ?", [
					newExpiration,
					normalizedId,
				]);
			} catch (error) {
				console.error("Error in touch-refresh update:", error);
			}
		});
	}

	private async processUserUpdateQueue() {
		if (
			this.isProcessingQueue ||
			this.userUpdateQueue.size === 0 ||
			!this.slackWrapper
		) {
			return;
		}

		this.isProcessingQueue = true;

		try {
			const usersToUpdate = Array.from(this.userUpdateQueue).slice(0, QUEUE_BATCH_SIZE);

			for (const userId of usersToUpdate) {
				try {
					console.log(`Background updating user: ${userId}`);
					const slackUser = await this.slackWrapper.getUserInfo(userId);

					await this.insertUser(
						userId.toUpperCase(),
						slackUser.real_name || slackUser.name || "Unknown",
						slackUser.profile?.pronouns || "",
						slackUser.profile?.image_512 || slackUser.profile?.image_192 || "",
					);

					this.userUpdateQueue.delete(userId);
				} catch (error) {
					console.warn(`Failed to update user ${userId}:`, error);
					this.userUpdateQueue.delete(userId);
				}
			}
		} catch (error) {
			console.error("Error processing user update queue:", error);
		} finally {
			this.isProcessingQueue = false;
		}
	}

	// --- Entity CRUD ---

	async insertUser(
		userId: string,
		displayName: string,
		pronouns: string,
		imageUrl: string,
		expirationHours?: number,
	) {
		const id = crypto.randomUUID();
		const userDefaultTTL = USER_DEFAULT_TTL_HOURS;
		const expiration =
			Date.now() + (expirationHours || userDefaultTTL) * MS_PER_HOUR;

		try {
			this.db.run(
				`INSERT INTO users (id, userId, displayName, pronouns, imageUrl, expiration)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(userId)
           DO UPDATE SET imageUrl = ?, expiration = ?`,
				[
					id,
					userId.toUpperCase(),
					displayName,
					pronouns,
					imageUrl,
					expiration,
					imageUrl,
					expiration,
				],
			);
			return true;
		} catch (error) {
			console.error("Error inserting/updating user:", error);
			return false;
		}
	}

	async insertEmoji(
		name: string,
		alias: string | null,
		imageUrl: string,
		expirationHours?: number,
	) {
		const id = crypto.randomUUID();
		const expiration =
			Date.now() + (expirationHours || this.defaultExpiration) * MS_PER_HOUR;

		try {
			this.db.run(
				`INSERT INTO emojis (id, name, alias, imageUrl, expiration)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(name)
          DO UPDATE SET imageUrl = ?, expiration = ?`,
				[
					id,
					name.toLowerCase(),
					alias?.toLowerCase() || null,
					imageUrl,
					expiration,
					imageUrl,
					expiration,
				],
			);
			return true;
		} catch (error) {
			console.error("Error inserting/updating emoji:", error);
			return false;
		}
	}

	async batchInsertEmojis(
		emojis: Array<{ name: string; imageUrl: string; alias: string | null }>,
		expirationHours?: number,
	): Promise<boolean> {
		try {
			const expiration =
				Date.now() + (expirationHours || this.defaultExpiration) * MS_PER_HOUR;

			this.db.transaction(() => {
				for (const emoji of emojis) {
					const id = crypto.randomUUID();
					this.db.run(
						`INSERT INTO emojis (id, name, alias, imageUrl, expiration)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(name)
             DO UPDATE SET imageUrl = ?, expiration = ?`,
						[
							id,
							emoji.name.toLowerCase(),
							emoji.alias?.toLowerCase() || null,
							emoji.imageUrl,
							expiration,
							emoji.imageUrl,
							expiration,
						],
					);
				}
			})();

			return true;
		} catch (error) {
			console.error("Error batch inserting emojis:", error);
			return false;
		}
	}

	async getUser(userId: string): Promise<User | null> {
		const normalizedId = userId.toUpperCase();
		const result = this.stmtGetUser.get(normalizedId) as User;

		if (!result) {
			return null;
		}

		const now = Date.now();
		const expiration = new Date(result.expiration).getTime();

		if (expiration < now) {
			this.db.run("DELETE FROM users WHERE userId = ?", [normalizedId]);
			return null;
		}

		const twentyFourHoursAgo = now - TOUCH_REFRESH_THRESHOLD_MS;
		const userAge = expiration - USER_CLEANUP_AGE_MS;

		if (userAge < twentyFourHoursAgo) {
			const newExpiration = now + USER_CLEANUP_AGE_MS;
			this.flushTouchRefresh(newExpiration, normalizedId);
			this.queueUserUpdate(normalizedId);
			console.log(
				`Touch-refresh: Extended TTL for user ${normalizedId} and queued for update`,
			);
		}

		return {
			type: "user",
			id: result.id,
			userId: result.userId,
			displayName: result.displayName,
			pronouns: result.pronouns,
			imageUrl: result.imageUrl,
			expiration: new Date(result.expiration),
		};
	}

	async getEmoji(name: string): Promise<Emoji | null> {
		const result = this.stmtGetEmoji.get(
			name.toLowerCase(),
			Date.now(),
		) as Emoji;

		return result
			? {
					type: "emoji",
					id: result.id,
					name: result.name,
					alias: result.alias || null,
					imageUrl: result.imageUrl,
					expiration: new Date(result.expiration),
				}
			: null;
	}

	async getAllEmojis(): Promise<Emoji[]> {
		const results = this.db
			.query("SELECT * FROM emojis WHERE expiration > ?")
			.all(Date.now()) as Emoji[];

		return results.map((result) => ({
			type: "emoji",
			id: result.id,
			name: result.name,
			alias: result.alias || null,
			imageUrl: result.imageUrl,
			expiration: new Date(result.expiration),
		}));
	}

	// --- Delegated analytics methods ---

	recordRequest(
		endpoint: string,
		statusCode: number,
		userAgent?: string,
		responseTime?: number,
		referer?: string,
	): void {
		this.analytics.recordRequest(endpoint, statusCode, userAgent, responseTime, referer);
	}

	async getAnalytics(days: number = 7): Promise<FullAnalyticsData> {
		return this.analytics.getAnalytics(days, () => this.getUptime());
	}

	async getEssentialStats(days: number = 7): Promise<EssentialStatsData> {
		return this.analytics.getEssentialStats(days, () => this.getUptime());
	}

	async getChartData(days: number = 7): Promise<ChartData> {
		return this.analytics.getChartData(days);
	}

	getTraffic(
		options: { days?: number; startTime?: number; endTime?: number } = {},
	): Array<{ bucket: number; hits: number; avgLatency: number | null }> {
		return this.analytics.getTraffic(options);
	}

	async getUserAgents(): Promise<Array<{ userAgent: string; hits: number }>> {
		return this.analytics.getUserAgents();
	}

	async getUserAgentCount(): Promise<number> {
		return this.analytics.getUserAgentCount();
	}

	async getReferers(): Promise<Array<{ refererHost: string; hits: number }>> {
		return this.analytics.getReferers();
	}
	/**
	 * Closes all resources: stops cron jobs, clears intervals, closes database.
	 * Call this during graceful shutdown.
	 */
	close() {
		for (const task of this.cronTasks) {
			task.stop();
		}
		this.cronTasks = [];

		if (this.queueIntervalId) {
			clearInterval(this.queueIntervalId);
			this.queueIntervalId = undefined;
		}

		this.healthMonitor.endUptimeSession();
		this.db.close();
	}
}

export { Cache as SlackCache };
