import { Database } from "bun:sqlite";
import { schedule } from "node-cron";
import { bucketAnalyticsMigration } from "./migrations/bucketAnalyticsMigration";
import { endpointGroupingMigration } from "./migrations/endpointGroupingMigration";
import { logGroupingMigration } from "./migrations/logGroupingMigration";
import { MigrationManager } from "./migrations/migrationManager";
import type { SlackUser } from "./slack";

/**
 * Interface for Slack user provider - minimal interface Cache needs
 */
interface SlackUserProvider {
	getUserInfo(userId: string): Promise<SlackUser>;
}

/**
 * Analytics data type definitions
 */
interface EndpointMetrics {
	endpoint: string;
	count: number;
	averageResponseTime: number;
}

interface StatusMetrics {
	status: number;
	count: number;
	averageResponseTime: number;
}

interface DayMetrics {
	date: string;
	count: number;
	averageResponseTime: number;
}

interface UserAgentMetrics {
	userAgent: string;
	count: number;
}

interface LatencyPercentiles {
	p50: number | null;
	p75: number | null;
	p90: number | null;
	p95: number | null;
	p99: number | null;
}

interface LatencyDistribution {
	range: string;
	count: number;
	percentage: number;
}

interface LatencyOverTimeMetrics {
	time: string;
	averageResponseTime: number;
	p95: number | null;
	count: number;
}

interface LatencyAnalytics {
	percentiles: LatencyPercentiles;
	distribution: Array<LatencyDistribution>;
	slowestEndpoints: Array<EndpointMetrics>;
	latencyOverTime: Array<LatencyOverTimeMetrics>;
}

interface PerformanceMetrics {
	uptime: number;
	errorRate: number;
	throughput: number;
	apdex: number;
	cacheHitRate: number;
}

interface PeakTraffic {
	peakHour: string;
	peakRequests: number;
	peakDay: string;
	peakDayRequests: number;
}

interface DashboardMetrics {
	statsRequests: number;
	totalWithStats: number;
}

interface TrafficOverview {
	time: string;
	routes: Record<string, number>;
	total: number;
}

/**
 * Analytics method return types
 */
interface FullAnalyticsData {
	totalRequests: number;
	requestsByEndpoint: Array<EndpointMetrics>;
	requestsByStatus: Array<StatusMetrics>;
	requestsByDay: Array<DayMetrics>;
	averageResponseTime: number | null;
	topUserAgents: Array<UserAgentMetrics>;
	latencyAnalytics: LatencyAnalytics;
	performanceMetrics: PerformanceMetrics;
	peakTraffic: PeakTraffic;
	dashboardMetrics: DashboardMetrics;
	trafficOverview: Array<TrafficOverview>;
}

interface EssentialStatsData {
	totalRequests: number;
	averageResponseTime: number | null;
	uptime: number;
}

interface ChartData {
	requestsByDay: Array<DayMetrics>;
	latencyOverTime: Array<LatencyOverTimeMetrics>;
}

type UserAgentData = Array<UserAgentMetrics>;

/**
 * Discriminated union for all analytics cache data types
 */
type AnalyticsCacheData =
	| { type: "analytics"; data: FullAnalyticsData }
	| { type: "essential"; data: EssentialStatsData }
	| { type: "charts"; data: ChartData }
	| { type: "useragents"; data: UserAgentData };

/**
 * Type-safe analytics cache entry
 */
interface AnalyticsCacheEntry {
	data: AnalyticsCacheData;
	timestamp: number;
}

/**
 * Type guard functions for cache data
 */
function isAnalyticsData(
	data: AnalyticsCacheData,
): data is { type: "analytics"; data: FullAnalyticsData } {
	return data.type === "analytics";
}

function isEssentialStatsData(
	data: AnalyticsCacheData,
): data is { type: "essential"; data: EssentialStatsData } {
	return data.type === "essential";
}

function isChartData(
	data: AnalyticsCacheData,
): data is { type: "charts"; data: ChartData } {
	return data.type === "charts";
}

function isUserAgentData(
	data: AnalyticsCacheData,
): data is { type: "useragents"; data: UserAgentData } {
	return data.type === "useragents";
}

/**
 * Type-safe cache helper methods
 */
class AnalyticsCache {
	private cache: Map<string, AnalyticsCacheEntry>;
	private cacheTTL: number;
	private maxCacheSize: number;

	constructor(cacheTTL: number = 30000, maxCacheSize: number = 10) {
		this.cache = new Map();
		this.cacheTTL = cacheTTL;
		this.maxCacheSize = maxCacheSize;
	}

	/**
	 * Get cached analytics data with type safety
	 */
	getAnalyticsData(key: string): FullAnalyticsData | null {
		const cached = this.cache.get(key);
		const now = Date.now();

		if (
			cached &&
			now - cached.timestamp < this.cacheTTL &&
			isAnalyticsData(cached.data)
		) {
			return cached.data.data;
		}
		return null;
	}

	/**
	 * Get cached essential stats data with type safety
	 */
	getEssentialStatsData(key: string): EssentialStatsData | null {
		const cached = this.cache.get(key);
		const now = Date.now();

		if (
			cached &&
			now - cached.timestamp < this.cacheTTL &&
			isEssentialStatsData(cached.data)
		) {
			return cached.data.data;
		}
		return null;
	}

	/**
	 * Get cached chart data with type safety
	 */
	getChartData(key: string): ChartData | null {
		const cached = this.cache.get(key);
		const now = Date.now();

		if (
			cached &&
			now - cached.timestamp < this.cacheTTL &&
			isChartData(cached.data)
		) {
			return cached.data.data;
		}
		return null;
	}

	/**
	 * Get cached user agent data with type safety
	 */
	getUserAgentData(key: string): UserAgentData | null {
		const cached = this.cache.get(key);
		const now = Date.now();

		if (
			cached &&
			now - cached.timestamp < this.cacheTTL &&
			isUserAgentData(cached.data)
		) {
			return cached.data.data;
		}
		return null;
	}

	/**
	 * Set analytics data in cache with type safety
	 */
	setAnalyticsData(key: string, data: FullAnalyticsData): void {
		this.setCacheEntry(key, { type: "analytics", data });
	}

	/**
	 * Set essential stats data in cache with type safety
	 */
	setEssentialStatsData(key: string, data: EssentialStatsData): void {
		this.setCacheEntry(key, { type: "essential", data });
	}

	/**
	 * Set chart data in cache with type safety
	 */
	setChartData(key: string, data: ChartData): void {
		this.setCacheEntry(key, { type: "charts", data });
	}

	/**
	 * Set user agent data in cache with type safety
	 */
	setUserAgentData(key: string, data: UserAgentData): void {
		this.setCacheEntry(key, { type: "useragents", data });
	}

	/**
	 * Internal method to set cache entry and manage cache size
	 */
	private setCacheEntry(key: string, data: AnalyticsCacheData): void {
		this.cache.set(key, {
			data,
			timestamp: Date.now(),
		});

		// Clean up old cache entries
		if (this.cache.size > this.maxCacheSize) {
			const keys = Array.from(this.cache.keys());
			const oldestKey = keys[0];
			if (oldestKey) {
				this.cache.delete(oldestKey);
			}
		}
	}
}

/**
 * @fileoverview This file contains the Cache class for storing user and emoji data with automatic expiration. To use the module in your project, import the default export and create a new instance of the Cache class. The class provides methods for inserting and retrieving user and emoji data from the cache. The cache automatically purges expired items every hour.
 * @module cache
 * @requires bun:sqlite
 * @requires node-cron
 */

/**
 * Base interface for cached items
 */
interface CacheItem {
	id: string;
	imageUrl: string;
	expiration: Date;
}

/**
 * Interface for cached user data
 */
interface User extends CacheItem {
	type: "user";
	displayName: string;
	pronouns: string;
	userId: string;
}

/**
 * Interface for cached emoji data
 */
interface Emoji extends CacheItem {
	type: "emoji";
	name: string;
	alias: string | null;
}

/**
 * Cache class for storing user and emoji data with automatic expiration
 */
class Cache {
	private db: Database;
	private defaultExpiration: number; // in hours
	private onEmojiExpired?: () => void;
	private typedAnalyticsCache: AnalyticsCache; // Type-safe analytics cache helper

	// Background user update queue to avoid Slack API limits
	private userUpdateQueue: Set<string> = new Set();
	private isProcessingQueue = false;
	private slackWrapper?: SlackUserProvider; // Will be injected after construction

	/**
	 * Creates a new Cache instance
	 * @param dbPath Path to SQLite database file
	 * @param defaultExpirationHours Default cache expiration in hours
	 * @param onEmojiExpired Optional callback function called when emojis expire
	 */
	constructor(
		dbPath: string,
		defaultExpirationHours = 24,
		onEmojiExpired?: () => void,
	) {
		this.db = new Database(dbPath);
		this.defaultExpiration = defaultExpirationHours;
		this.onEmojiExpired = onEmojiExpired;

		// Initialize type-safe analytics cache
		this.typedAnalyticsCache = new AnalyticsCache();

		this.initDatabase();
		this.setupPurgeSchedule();
		this.startQueueProcessor();

		// Run migrations
		this.runMigrations();
	}

	/**
	 * Initializes the database tables
	 * @private
	 */
	private initDatabase() {
		// Create users table
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

		// Create emojis table
		this.db.run(`
      CREATE TABLE IF NOT EXISTS emojis (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE,
        alias TEXT,
        imageUrl TEXT,
        expiration INTEGER
      )
    `);

		// Create bucketed traffic tables (10-minute, hourly, daily)
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

		// Create user agent stats table
		this.db.run(`
			CREATE TABLE IF NOT EXISTS user_agent_stats (
				user_agent TEXT PRIMARY KEY,
				hits INTEGER NOT NULL DEFAULT 1,
				last_seen INTEGER NOT NULL
			) WITHOUT ROWID
		`);

		// Create indexes for time-range queries
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

		// Enable WAL mode for better concurrent performance
		this.db.run("PRAGMA journal_mode = WAL");
		this.db.run("PRAGMA synchronous = NORMAL");
		this.db.run("PRAGMA cache_size = 50000"); // Increased cache size
		this.db.run("PRAGMA temp_store = memory");
		this.db.run("PRAGMA mmap_size = 268435456"); // 256MB memory map
		this.db.run("PRAGMA page_size = 4096"); // Optimal page size

		// check if there are any emojis in the db
		if (this.onEmojiExpired) {
			const result = this.db
				.query("SELECT COUNT(*) as count FROM emojis WHERE expiration > ?")
				.get(Date.now()) as { count: number };
			if (result.count === 0) {
				this.onEmojiExpired();
			}
		}
	}

	/**
	 * Sets up scheduled tasks for cache maintenance
	 * @private
	 */
	private setupPurgeSchedule() {
		// Run purge every hour at 45 minutes (only expired items, analytics cleanup)
		schedule("45 * * * *", async () => {
			await this.purgeExpiredItems();
			await this.lazyUserCleanup();
		});

		// Schedule emoji updates daily on the hour
		schedule("0 * * * *", async () => {
			console.log("Scheduled emoji update starting...");
			if (this.onEmojiExpired) {
				this.onEmojiExpired();
				console.log("Scheduled emoji update completed");
			}
		});
	}

	/**
	 * Run database migrations
	 * @private
	 */
	private async runMigrations() {
		try {
			// Define migrations directly here to avoid circular dependencies
			// Note: We define migrations both here and in migrations/index.ts
			// This is intentional to prevent circular imports
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

	/**
	 * Purges expired items from the cache
	 * @returns int indicating number of items purged
	 */
	async purgeExpiredItems(): Promise<number> {
		// Only purge emojis - users will use lazy loading with longer TTL
		const result2 = this.db.run("DELETE FROM emojis WHERE expiration < ?", [
			Date.now(),
		]);

		// Clean up old 10-minute bucket data (older than 24 hours)
		const oneDayAgoSec = Math.floor(Date.now() / 1000) - 86400;
		const cleanupBucket = oneDayAgoSec - (oneDayAgoSec % 600);
		this.db.run("DELETE FROM traffic_10min WHERE bucket < ?", [cleanupBucket]);

		// Emojis are now updated on schedule, not on expiration
		return result2.changes;
	}

	/**
	 * Lazy cleanup of truly expired users (older than 7 days) during off-peak hours only
	 * This runs much less frequently than the old aggressive purging
	 * @private
	 */
	private async lazyUserCleanup(): Promise<void> {
		const currentHour = new Date().getHours();
		// Only run during off-peak hours (3-5 AM) and not every time
		if (currentHour >= 3 && currentHour < 5 && Math.random() < 0.1) {
			// 10% chance
			const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
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

	/**
	 * Purges cache for a specific user
	 * @param userId The Slack user ID to purge from cache
	 * @returns boolean indicating if any user was purged
	 */
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

	/**
	 * Purges all items from the cache
	 * @returns Object containing purge results
	 */
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

	/**
	 * Checks if the cache is healthy by testing database connectivity
	 * @returns boolean indicating if cache is healthy
	 */
	async healthCheck(): Promise<boolean> {
		try {
			this.db.query("SELECT 1").get();
			return true;
		} catch (error) {
			console.error("Cache health check failed:", error);
			return false;
		}
	}

	/**
	 * Detailed health check with component status
	 * @returns Object with detailed health information
	 */
	async detailedHealthCheck(): Promise<{
		status: "healthy" | "degraded" | "unhealthy";
		checks: {
			database: { status: boolean; latency?: number };
			slackApi: { status: boolean; error?: string };
			queueDepth: number;
			memoryUsage: {
				heapUsed: number;
				heapTotal: number;
				percentage: number;
			};
		};
		uptime: number;
	}> {
		const checks = {
			database: { status: false, latency: 0 },
			slackApi: { status: false },
			queueDepth: this.userUpdateQueue.size,
			memoryUsage: {
				heapUsed: 0,
				heapTotal: 0,
				percentage: 0,
			},
		};

		// Check database
		try {
			const start = Date.now();
			this.db.query("SELECT 1").get();
			checks.database = { status: true, latency: Date.now() - start };
		} catch (error) {
			console.error("Database health check failed:", error);
		}

		// Check Slack API if wrapper is available
		if (this.slackWrapper) {
			try {
				await this.slackWrapper.getUserInfo("U062UG485EE"); // Use a known test user
				checks.slackApi = { status: true };
			} catch (error) {
				checks.slackApi = {
					status: false,
					error: error instanceof Error ? error.message : "Unknown error",
				};
			}
		} else {
			checks.slackApi = { status: true }; // No wrapper means not critical
		}

		// Check memory usage
		const memUsage = process.memoryUsage();
		const bytesToMiB = (bytes: number) => bytes / 1024 / 1024;

		const heapUsedMiB = bytesToMiB(memUsage.heapUsed);
		const heapTotalMiB = bytesToMiB(memUsage.heapTotal);
		const heapPercent =
			heapTotalMiB > 0 ? (heapUsedMiB / heapTotalMiB) * 100 : 0;
		const rssMiB = bytesToMiB(memUsage.rss);
		const externalMiB = bytesToMiB(memUsage.external || 0);
		const arrayBuffersMiB = bytesToMiB(memUsage.arrayBuffers || 0);

		checks.memoryUsage = {
			heapUsed: Math.round(heapUsedMiB),
			heapTotal: Math.round(heapTotalMiB),
			percentage: Math.round(heapPercent),
			details: {
				heapUsedMiB: Number(heapUsedMiB.toFixed(2)),
				heapTotalMiB: Number(heapTotalMiB.toFixed(2)),
				heapPercent: Number(heapPercent.toFixed(2)),
				rssMiB: Number(rssMiB.toFixed(2)),
				externalMiB: Number(externalMiB.toFixed(2)),
				arrayBuffersMiB: Number(arrayBuffersMiB.toFixed(2)),
			},
		};

		// Determine overall status
		let status: "healthy" | "degraded" | "unhealthy" = "healthy";
		if (!checks.database.status) {
			status = "unhealthy";
		} else if (!checks.slackApi.status || checks.queueDepth > 100) {
			status = "degraded";
		} else if (checks.memoryUsage.percentage >= 120) {
			status = "degraded";
		}

		return {
			status,
			checks,
			uptime: process.uptime(),
		};
	}

	/**
	 * Sets the Slack wrapper for user updates
	 * @param slackWrapper SlackUserProvider instance for API calls
	 */
	setSlackWrapper(slackWrapper: SlackUserProvider) {
		this.slackWrapper = slackWrapper;
	}

	/**
	 * Adds a user to the background update queue
	 * @param userId User ID to queue for update
	 * @private
	 */
	private queueUserUpdate(userId: string) {
		this.userUpdateQueue.add(userId.toUpperCase());
	}

	/**
	 * Starts the background queue processor
	 * @private
	 */
	private startQueueProcessor() {
		// Process queue every 30 seconds to respect Slack API limits
		setInterval(async () => {
			await this.processUserUpdateQueue();
		}, 30 * 1000);
	}

	/**
	 * Processes the user update queue with rate limiting
	 * @private
	 */
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
			// Process up to 3 users at a time to respect API limits
			const usersToUpdate = Array.from(this.userUpdateQueue).slice(0, 3);

			for (const userId of usersToUpdate) {
				try {
					console.log(`Background updating user: ${userId}`);
					const slackUser = await this.slackWrapper.getUserInfo(userId);

					// Update user in cache with fresh data
					await this.insertUser(
						slackUser.id,
						slackUser.real_name || slackUser.name || "Unknown",
						slackUser.profile?.pronouns || "",
						slackUser.profile?.image_512 || slackUser.profile?.image_192 || "",
					);

					// Remove from queue after successful update
					this.userUpdateQueue.delete(userId);
				} catch (error) {
					console.warn(`Failed to update user ${userId}:`, error);
					// Remove from queue even if failed to prevent infinite retry
					this.userUpdateQueue.delete(userId);
				}
			}
		} catch (error) {
			console.error("Error processing user update queue:", error);
		} finally {
			this.isProcessingQueue = false;
		}
	}

	/**
	 * Inserts a user into the cache
	 * @param userId Unique identifier for the user
	 * @param imageUrl URL of the user's image
	 * @param expirationHours Optional custom expiration time in hours
	 * @returns boolean indicating success
	 */
	async insertUser(
		userId: string,
		displayName: string,
		pronouns: string,
		imageUrl: string,
		expirationHours?: number,
	) {
		const id = crypto.randomUUID();
		// Users get longer TTL (7 days) for lazy loading, unless custom expiration specified
		const userDefaultTTL = 7 * 24; // 7 days in hours
		const expiration =
			Date.now() + (expirationHours || userDefaultTTL) * 3600000;

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

	/**
	 * Inserts an emoji into the cache
	 * @param name Name of the emoji
	 * @param imageUrl URL of the emoji image
	 * @param expirationHours Optional custom expiration time in hours
	 * @returns boolean indicating success
	 */
	async insertEmoji(
		name: string,
		alias: string | null,
		imageUrl: string,
		expirationHours?: number,
	) {
		const id = crypto.randomUUID();
		const expiration =
			Date.now() + (expirationHours || this.defaultExpiration) * 3600000;

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

	/**
	 * Batch inserts multiple emojis into the cache
	 * @param emojis Array of {name, imageUrl} objects to insert
	 * @param expirationHours Optional custom expiration time in hours for all emojis
	 * @returns boolean indicating if all insertions were successful
	 */
	async batchInsertEmojis(
		emojis: Array<{ name: string; imageUrl: string; alias: string | null }>,
		expirationHours?: number,
	): Promise<boolean> {
		try {
			const expiration =
				Date.now() + (expirationHours || this.defaultExpiration) * 3600000;

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

	/**
	 * Lists all emoji in the cache
	 * @returns Array of Emoji objects that haven't expired
	 */
	async listEmojis(): Promise<Emoji[]> {
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

	/**
	 * Retrieves a user from the cache
	 * @param userId Unique identifier of the user
	 * @returns User object if found and not expired, null otherwise
	 */
	async getUser(userId: string): Promise<User | null> {
		const result = this.db
			.query("SELECT * FROM users WHERE userId = ?")
			.get(userId.toUpperCase()) as User;

		if (!result) {
			return null;
		}

		const now = Date.now();
		const expiration = new Date(result.expiration).getTime();

		// If user is expired, remove and return null
		if (expiration < now) {
			this.db.run("DELETE FROM users WHERE userId = ?", [userId]);
			return null;
		}

		// Touch-to-refresh: if user is older than 24 hours, extend TTL and queue for background update
		const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
		const userAge = expiration - 7 * 24 * 60 * 60 * 1000; // When user was originally cached

		if (userAge < twentyFourHoursAgo) {
			// Extend TTL by another 7 days from now
			const newExpiration = now + 7 * 24 * 60 * 60 * 1000;
			this.db.run("UPDATE users SET expiration = ? WHERE userId = ?", [
				newExpiration,
				userId.toUpperCase(),
			]);

			// Queue for background update to get fresh data
			this.queueUserUpdate(userId);

			console.log(
				`Touch-refresh: Extended TTL for user ${userId} and queued for update`,
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

	/**
	 * Retrieves an emoji from the cache
	 * @param name Name of the emoji
	 * @returns Emoji object if found and not expired, null otherwise
	 */
	async getEmoji(name: string): Promise<Emoji | null> {
		const result = this.db
			.query("SELECT * FROM emojis WHERE name = ? AND expiration > ?")
			.get(name.toLowerCase(), Date.now()) as Emoji;

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

	/**
	 * Get all emojis from the cache
	 * @returns Array of all non-expired emojis
	 */
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

	/**
	 * Records a request for analytics using bucketed time-series storage
	 * @param endpoint The endpoint that was accessed
	 * @param method HTTP method (unused, kept for API compatibility)
	 * @param statusCode HTTP status code
	 * @param userAgent User agent string
	 * @param ipAddress IP address of the client (unused, kept for API compatibility)
	 * @param responseTime Response time in milliseconds
	 */
	async recordRequest(
		endpoint: string,
		_method: string,
		statusCode: number,
		userAgent?: string,
		_ipAddress?: string,
		responseTime?: number,
	): Promise<void> {
		try {
			const now = Math.floor(Date.now() / 1000);
			const bucket10min = now - (now % 600);
			const bucketHour = now - (now % 3600);
			const bucketDay = now - (now % 86400);
			const respTime = responseTime || 0;

			// Upsert into all three bucket tables
			this.db.run(
				`INSERT INTO traffic_10min (bucket, endpoint, status_code, hits, total_response_time)
				 VALUES (?1, ?2, ?3, 1, ?4)
				 ON CONFLICT(bucket, endpoint, status_code) DO UPDATE SET 
				 	hits = hits + 1,
				 	total_response_time = total_response_time + ?4`,
				[bucket10min, endpoint, statusCode, respTime],
			);

			this.db.run(
				`INSERT INTO traffic_hourly (bucket, endpoint, status_code, hits, total_response_time)
				 VALUES (?1, ?2, ?3, 1, ?4)
				 ON CONFLICT(bucket, endpoint, status_code) DO UPDATE SET 
				 	hits = hits + 1,
				 	total_response_time = total_response_time + ?4`,
				[bucketHour, endpoint, statusCode, respTime],
			);

			this.db.run(
				`INSERT INTO traffic_daily (bucket, endpoint, status_code, hits, total_response_time)
				 VALUES (?1, ?2, ?3, 1, ?4)
				 ON CONFLICT(bucket, endpoint, status_code) DO UPDATE SET 
				 	hits = hits + 1,
				 	total_response_time = total_response_time + ?4`,
				[bucketDay, endpoint, statusCode, respTime],
			);

			// Track user agent
			if (userAgent) {
				this.db.run(
					`INSERT INTO user_agent_stats (user_agent, hits, last_seen)
					 VALUES (?1, 1, ?2)
					 ON CONFLICT(user_agent) DO UPDATE SET 
					 	hits = hits + 1,
					 	last_seen = MAX(last_seen, ?2)`,
					[userAgent, Date.now()],
				);
			}
		} catch (error) {
			console.error("Error recording request analytics:", error);
		}
	}

	/**
	 * Helper to select the appropriate bucket table based on time range
	 */
	private selectBucketTable(days: number): {
		table: string;
		bucketSize: number;
	} {
		if (days <= 1) {
			return { table: "traffic_10min", bucketSize: 600 };
		} else if (days <= 30) {
			return { table: "traffic_hourly", bucketSize: 3600 };
		} else {
			return { table: "traffic_daily", bucketSize: 86400 };
		}
	}

	/**
	 * Helper to group endpoint names for display
	 */
	private groupEndpoint(endpoint: string): string {
		if (endpoint === "/" || endpoint === "/dashboard") {
			return "Dashboard";
		} else if (endpoint === "/health") {
			return "Health Check";
		} else if (endpoint === "/swagger" || endpoint.startsWith("/swagger")) {
			return "API Documentation";
		} else if (endpoint === "/emojis") {
			return "Emoji List";
		} else if (endpoint.match(/^\/emojis\/[^/]+$/) || endpoint === "/emojis/EMOJI_NAME") {
			return "Emoji Data";
		} else if (endpoint.match(/^\/emojis\/[^/]+\/r$/) || endpoint === "/emojis/EMOJI_NAME/r") {
			return "Emoji Redirects";
		} else if (endpoint.match(/^\/users\/[^/]+$/) || endpoint === "/users/USER_ID") {
			return "User Data";
		} else if (endpoint.match(/^\/users\/[^/]+\/r$/) || endpoint === "/users/USER_ID/r") {
			return "User Redirects";
		} else if (endpoint.match(/^\/users\/[^/]+\/purge$/) || endpoint === "/reset") {
			return "Cache Management";
		} else if (endpoint.includes("/users/") && endpoint.includes("/r")) {
			return "User Redirects";
		} else if (endpoint.includes("/users/")) {
			return "User Data";
		} else if (endpoint.includes("/emojis/") && endpoint.includes("/r")) {
			return "Emoji Redirects";
		} else if (endpoint.includes("/emojis/")) {
			return "Emoji Data";
		}
		return "Other";
	}

	/**
	 * Gets request analytics statistics using bucketed time-series data
	 * @param days Number of days to look back (default: 7)
	 * @returns Analytics data
	 */
	async getAnalytics(days: number = 7): Promise<{
		totalRequests: number;
		requestsByEndpoint: Array<{
			endpoint: string;
			count: number;
			averageResponseTime: number;
		}>;
		requestsByStatus: Array<{
			status: number;
			count: number;
			averageResponseTime: number;
		}>;
		requestsByDay: Array<{
			date: string;
			count: number;
			averageResponseTime: number;
		}>;
		averageResponseTime: number | null;
		topUserAgents: Array<{ userAgent: string; count: number }>;
		latencyAnalytics: {
			percentiles: {
				p50: number | null;
				p75: number | null;
				p90: number | null;
				p95: number | null;
				p99: number | null;
			};
			distribution: Array<{
				range: string;
				count: number;
				percentage: number;
			}>;
			slowestEndpoints: Array<{
				endpoint: string;
				averageResponseTime: number;
				count: number;
			}>;
			latencyOverTime: Array<{
				time: string;
				averageResponseTime: number;
				p95: number | null;
				count: number;
			}>;
		};
		performanceMetrics: {
			uptime: number;
			errorRate: number;
			throughput: number;
			apdex: number;
			cacheHitRate: number;
		};
		peakTraffic: {
			peakHour: string;
			peakRequests: number;
			peakDay: string;
			peakDayRequests: number;
		};
		dashboardMetrics: {
			statsRequests: number;
			totalWithStats: number;
		};
		trafficOverview: Array<{
			time: string;
			routes: Record<string, number>;
			total: number;
		}>;
	}> {
		const cacheKey = `analytics_${days}`;
		const cached = this.typedAnalyticsCache.getAnalyticsData(cacheKey);
		if (cached) {
			return cached;
		}

		const { table, bucketSize } = this.selectBucketTable(days);
		const cutoffBucket = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
		const alignedCutoff = cutoffBucket - (cutoffBucket % bucketSize);

		// Total requests (excluding stats endpoint)
		const totalResult = this.db
			.query(
				`SELECT SUM(hits) as count FROM ${table} WHERE bucket >= ? AND endpoint != '/stats'`,
			)
			.get(alignedCutoff) as { count: number | null };

		// Stats endpoint requests (tracked separately)
		const statsResult = this.db
			.query(
				`SELECT SUM(hits) as count FROM ${table} WHERE bucket >= ? AND endpoint = '/stats'`,
			)
			.get(alignedCutoff) as { count: number | null };

		// Get endpoint data from bucket table and group them
		const rawEndpointResults = this.db
			.query(
				`
         SELECT endpoint, SUM(hits) as count, SUM(total_response_time) as totalTime, SUM(hits) as totalHits
         FROM ${table}
         WHERE bucket >= ? AND endpoint != '/stats'
         GROUP BY endpoint
         ORDER BY count DESC
       `,
			)
			.all(alignedCutoff) as Array<{
			endpoint: string;
			count: number;
			totalTime: number;
			totalHits: number;
		}>;

		// Group endpoints using helper
		const endpointGroups: Record<
			string,
			{ count: number; totalResponseTime: number; requestCount: number }
		> = {};

		for (const result of rawEndpointResults) {
			const groupKey = this.groupEndpoint(result.endpoint);

			if (!endpointGroups[groupKey]) {
				endpointGroups[groupKey] = {
					count: 0,
					totalResponseTime: 0,
					requestCount: 0,
				};
			}

			const group = endpointGroups[groupKey];
			if (group) {
				group.count += result.count;
				if (result.totalTime && result.totalHits > 0) {
					group.totalResponseTime += result.totalTime;
					group.requestCount += result.totalHits;
				}
			}
		}

		// Convert back to array format with calculated averages
		const requestsByEndpoint = Object.entries(endpointGroups)
			.map(([endpoint, data]) => ({
				endpoint,
				count: data.count,
				averageResponseTime:
					data.requestCount > 0
						? data.totalResponseTime / data.requestCount
						: 0,
			}))
			.sort((a, b) => b.count - a.count);

		// Requests by status code from bucket table
		const statusResultsRaw = this.db
			.query(
				`
         SELECT status_code as status, SUM(hits) as count, SUM(total_response_time) as totalTime, SUM(hits) as totalHits
         FROM ${table}
         WHERE bucket >= ? AND endpoint != '/stats'
         GROUP BY status_code
         ORDER BY count DESC
       `,
			)
			.all(alignedCutoff) as Array<{
			status: number;
			count: number;
			totalTime: number;
			totalHits: number;
		}>;

		const statusResults = statusResultsRaw.map((s) => ({
			status: s.status,
			count: s.count,
			averageResponseTime: s.totalHits > 0 ? s.totalTime / s.totalHits : 0,
		}));

		// Requests over time from bucket table
		const timeResultsRaw = this.db
			.query(
				`
         SELECT 
           datetime(bucket, 'unixepoch') as date,
           SUM(hits) as count,
           SUM(total_response_time) as totalTime,
           SUM(hits) as totalHits
         FROM ${table}
         WHERE bucket >= ? AND endpoint != '/stats'
         GROUP BY bucket
         ORDER BY bucket ASC
       `,
			)
			.all(alignedCutoff) as Array<{
			date: string;
			count: number;
			totalTime: number;
			totalHits: number;
		}>;

		const timeResults = timeResultsRaw.map((r) => ({
			date: r.date,
			count: r.count,
			averageResponseTime: r.totalHits > 0 ? r.totalTime / r.totalHits : 0,
		}));

		// Average response time from bucket table
		const avgResponseResult = this.db
			.query(
				`
         SELECT SUM(total_response_time) as totalTime, SUM(hits) as totalHits
         FROM ${table}
         WHERE bucket >= ? AND endpoint != '/stats'
       `,
			)
			.get(alignedCutoff) as { totalTime: number | null; totalHits: number | null };

		const averageResponseTime =
			avgResponseResult.totalHits && avgResponseResult.totalHits > 0
				? (avgResponseResult.totalTime ?? 0) / avgResponseResult.totalHits
				: null;

		// Top user agents from user_agent_stats table (cumulative, no time filter)
		const topUserAgents = this.db
			.query(
				`
         SELECT user_agent as userAgent, hits as count
         FROM user_agent_stats
         WHERE user_agent IS NOT NULL
         ORDER BY hits DESC
         LIMIT 50
       `,
			)
			.all() as Array<{ userAgent: string; count: number }>;

		// Simplified latency analytics from bucket data
		const percentiles = {
			p50: null as number | null,
			p75: null as number | null,
			p90: null as number | null,
			p95: null as number | null,
			p99: null as number | null,
		};

		const distribution: Array<{ range: string; count: number; percentage: number }> = [];

		// Slowest endpoints from grouped data
		const slowestEndpoints = requestsByEndpoint
			.filter((e) => e.averageResponseTime > 0)
			.sort((a, b) => b.averageResponseTime - a.averageResponseTime)
			.slice(0, 10);

		// Latency over time from bucket table
		const latencyOverTimeRaw = this.db
			.query(
				`
         SELECT 
           datetime(bucket, 'unixepoch') as time,
           SUM(total_response_time) as totalTime,
           SUM(hits) as count
         FROM ${table}
         WHERE bucket >= ? AND endpoint != '/stats'
         GROUP BY bucket
         ORDER BY bucket ASC
       `,
			)
			.all(alignedCutoff) as Array<{
			time: string;
			totalTime: number;
			count: number;
		}>;

		const latencyOverTime = latencyOverTimeRaw.map((r) => ({
			time: r.time,
			averageResponseTime: r.count > 0 ? r.totalTime / r.count : 0,
			p95: null as number | null,
			count: r.count,
		}));

		// Performance Metrics
		const totalCount = totalResult.count ?? 0;
		const errorRequests = statusResults
			.filter((s) => s.status >= 400)
			.reduce((sum, s) => sum + s.count, 0);
		const errorRate = totalCount > 0 ? (errorRequests / totalCount) * 100 : 0;

		// Calculate throughput (requests per hour)
		const timeSpanHours = days * 24;
		const throughput = totalCount / timeSpanHours;

		// APDEX not available with bucket data (need raw response times)
		const apdex = 0;

		// Calculate cache hit rate (redirects vs data endpoints)
		const redirectRequests = requestsByEndpoint
			.filter(
				(e) =>
					e.endpoint === "User Redirects" || e.endpoint === "Emoji Redirects",
			)
			.reduce((sum, e) => sum + e.count, 0);
		const dataRequests = requestsByEndpoint
			.filter((e) => e.endpoint === "User Data" || e.endpoint === "Emoji Data")
			.reduce((sum, e) => sum + e.count, 0);
		const cacheHitRate =
			redirectRequests + dataRequests > 0
				? (redirectRequests / (redirectRequests + dataRequests)) * 100
				: 0;

		const uptime = Math.max(0, 100 - errorRate * 2);

		// Peak traffic analysis from bucket table
		const peakHourData = this.db
			.query(
				`
         SELECT 
           strftime('%H:00', datetime(bucket, 'unixepoch')) as hour,
           SUM(hits) as count
         FROM ${table}
         WHERE bucket >= ? AND endpoint != '/stats'
         GROUP BY strftime('%H:00', datetime(bucket, 'unixepoch'))
         ORDER BY count DESC
         LIMIT 1
       `,
			)
			.get(alignedCutoff) as { hour: string; count: number } | null;

		const peakDayData = this.db
			.query(
				`
         SELECT 
           DATE(bucket, 'unixepoch') as day,
           SUM(hits) as count
         FROM ${table}
         WHERE bucket >= ? AND endpoint != '/stats'
         GROUP BY DATE(bucket, 'unixepoch')
         ORDER BY count DESC
         LIMIT 1
       `,
			)
			.get(alignedCutoff) as { day: string; count: number } | null;

		// Traffic Overview from bucket table
		const trafficRaw = this.db
			.query(
				`
         SELECT 
           datetime(bucket, 'unixepoch') as time,
           endpoint,
           SUM(hits) as count
         FROM ${table}
         WHERE bucket >= ? AND endpoint != '/stats'
         GROUP BY bucket, endpoint
         ORDER BY bucket ASC
       `,
			)
			.all(alignedCutoff) as Array<{
			time: string;
			endpoint: string;
			count: number;
		}>;

		// Group by time and create route breakdown
		const timeGroups: Record<string, Record<string, number>> = {};
		for (const row of trafficRaw) {
			if (!timeGroups[row.time]) {
				timeGroups[row.time] = {};
			}

			const groupKey = this.groupEndpoint(row.endpoint);
			const group = timeGroups[row.time];

			if (group) {
				group[groupKey] = (group[groupKey] || 0) + row.count;
			}
		}

		const trafficOverview = Object.entries(timeGroups)
			.map(([time, routes]) => ({
				time,
				routes,
				total: Object.values(routes).reduce((sum, count) => sum + count, 0),
			}))
			.sort((a, b) => a.time.localeCompare(b.time));

		const result = {
			totalRequests: totalCount,
			requestsByEndpoint: requestsByEndpoint,
			requestsByStatus: statusResults,
			requestsByDay: timeResults,
			averageResponseTime: averageResponseTime,
			topUserAgents: topUserAgents,
			latencyAnalytics: {
				percentiles,
				distribution,
				slowestEndpoints,
				latencyOverTime,
			},
			performanceMetrics: {
				uptime,
				errorRate,
				throughput,
				apdex,
				cacheHitRate,
			},
			peakTraffic: {
				peakHour: peakHourData?.hour || "N/A",
				peakRequests: peakHourData?.count || 0,
				peakDay: peakDayData?.day || "N/A",
				peakDayRequests: peakDayData?.count || 0,
			},
			dashboardMetrics: {
				statsRequests: statsResult.count,
				totalWithStats: totalCount + statsResult.count,
			},
			trafficOverview,
		};

		// Cache the result
		this.typedAnalyticsCache.setAnalyticsData(cacheKey, result);

		return result;
	}

	/**
	 * Gets essential stats only (fast loading)
	 * @param days Number of days to look back (default: 7)
	 * @returns Essential stats data
	 */
	async getEssentialStats(days: number = 7): Promise<{
		totalRequests: number;
		averageResponseTime: number | null;
		uptime: number;
	}> {
		const cacheKey = `essential_${days}`;
		const cached = this.typedAnalyticsCache.getEssentialStatsData(cacheKey);

		if (cached) {
			return cached;
		}

		const { table, bucketSize } = this.selectBucketTable(days);
		const cutoffBucket = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
		const alignedCutoff = cutoffBucket - (cutoffBucket % bucketSize);

		// Total requests from bucket table
		const totalResult = this.db
			.query(
				`SELECT SUM(hits) as count FROM ${table} WHERE bucket >= ? AND endpoint != '/stats'`,
			)
			.get(alignedCutoff) as { count: number | null };

		// Average response time from bucket table
		const avgResponseResult = this.db
			.query(
				`SELECT SUM(total_response_time) as totalTime, SUM(hits) as totalHits FROM ${table} WHERE bucket >= ? AND endpoint != '/stats'`,
			)
			.get(alignedCutoff) as { totalTime: number | null; totalHits: number | null };

		// Error rate from bucket table
		const errorResult = this.db
			.query(
				`SELECT SUM(hits) as count FROM ${table} WHERE bucket >= ? AND status_code >= 400 AND endpoint != '/stats'`,
			)
			.get(alignedCutoff) as { count: number | null };

		const totalCount = totalResult.count ?? 0;
		const errorRate = totalCount > 0 ? ((errorResult.count ?? 0) / totalCount) * 100 : 0;
		const uptime = Math.max(0, 100 - errorRate * 2);

		const result = {
			totalRequests: totalCount,
			averageResponseTime:
				avgResponseResult.totalHits && avgResponseResult.totalHits > 0
					? (avgResponseResult.totalTime ?? 0) / avgResponseResult.totalHits
					: null,
			uptime: uptime,
		};

		this.typedAnalyticsCache.setEssentialStatsData(cacheKey, result);

		return result;
	}

	/**
	 * Gets chart data only (requests and latency over time)
	 * @param days Number of days to look back (default: 7)
	 * @returns Chart data
	 */
	async getChartData(days: number = 7): Promise<{
		requestsByDay: Array<{
			date: string;
			count: number;
			averageResponseTime: number;
		}>;
		latencyOverTime: Array<{
			time: string;
			averageResponseTime: number;
			p95: number | null;
			count: number;
		}>;
	}> {
		const cacheKey = `charts_${days}`;
		const cached = this.typedAnalyticsCache.getChartData(cacheKey);

		if (cached) {
			return cached;
		}

		const { table, bucketSize } = this.selectBucketTable(days);
		const cutoffBucket = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
		const alignedCutoff = cutoffBucket - (cutoffBucket % bucketSize);

		// Requests over time from bucket table
		const timeResultsRaw = this.db
			.query(
				`
         SELECT 
           datetime(bucket, 'unixepoch') as date,
           SUM(hits) as count,
           SUM(total_response_time) as totalTime,
           SUM(hits) as totalHits
         FROM ${table}
         WHERE bucket >= ? AND endpoint != '/stats'
         GROUP BY bucket
         ORDER BY bucket ASC
       `,
			)
			.all(alignedCutoff) as Array<{
			date: string;
			count: number;
			totalTime: number;
			totalHits: number;
		}>;

		const requestsByDay = timeResultsRaw.map((r) => ({
			date: r.date,
			count: r.count,
			averageResponseTime: r.totalHits > 0 ? r.totalTime / r.totalHits : 0,
		}));

		// Latency over time (same query, different format)
		const latencyOverTime = timeResultsRaw.map((r) => ({
			time: r.date,
			averageResponseTime: r.totalHits > 0 ? r.totalTime / r.totalHits : 0,
			p95: null as number | null,
			count: r.count,
		}));

		const result = {
			requestsByDay,
			latencyOverTime,
		};

		this.typedAnalyticsCache.setChartData(cacheKey, result);

		return result;
	}

	/**
	 * Gets user agents data from cumulative stats table
	 * @param _days Unused - user_agent_stats is cumulative
	 * @returns User agents data
	 */
	async getUserAgents(
		_days: number = 7,
	): Promise<Array<{ userAgent: string; count: number }>> {
		const cacheKey = "useragents_all";
		const cached = this.typedAnalyticsCache.getUserAgentData(cacheKey);

		if (cached) {
			return cached;
		}

		// Query user_agent_stats table directly (cumulative, no time filtering)
		const topUserAgents = this.db
			.query(
				`
         SELECT user_agent as userAgent, hits as count
         FROM user_agent_stats
         WHERE user_agent IS NOT NULL
         ORDER BY hits DESC
         LIMIT 50
       `,
			)
			.all() as Array<{ userAgent: string; count: number }>;

		this.typedAnalyticsCache.setUserAgentData(cacheKey, topUserAgents);

		return topUserAgents;
	}
}

export { Cache as SlackCache };
