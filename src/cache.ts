import { Database } from "bun:sqlite";
import { schedule } from "node-cron";
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

		// Create request analytics table
		this.db.run(`
      CREATE TABLE IF NOT EXISTS request_analytics (
        id TEXT PRIMARY KEY,
        endpoint TEXT NOT NULL,
        method TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        user_agent TEXT,
        ip_address TEXT,
        timestamp INTEGER NOT NULL,
        response_time INTEGER
      )
    `);

		// Create index for faster queries
		this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_request_analytics_timestamp
      ON request_analytics(timestamp)
    `);

		this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_request_analytics_endpoint
      ON request_analytics(endpoint)
    `);

		this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_request_analytics_status_timestamp
      ON request_analytics(status_code, timestamp)
    `);

		this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_request_analytics_response_time
      ON request_analytics(response_time) WHERE response_time IS NOT NULL
    `);

		this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_request_analytics_composite
      ON request_analytics(timestamp, endpoint, status_code)
    `);

		// Additional performance indexes
		this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_request_analytics_user_agent
      ON request_analytics(user_agent, timestamp) WHERE user_agent IS NOT NULL
    `);

		this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_request_analytics_time_response
      ON request_analytics(timestamp, response_time) WHERE response_time IS NOT NULL
    `);

		this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_request_analytics_exclude_stats
      ON request_analytics(timestamp, endpoint, status_code) WHERE endpoint != '/stats'
    `);

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
			const migrations = [endpointGroupingMigration, logGroupingMigration];
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

		// Clean up old analytics data (older than 30 days) - moved to off-peak hours
		const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
		const currentHour = new Date().getHours();
		// Only run analytics cleanup during off-peak hours (2-6 AM)
		if (currentHour >= 2 && currentHour < 6) {
			this.db.run("DELETE FROM request_analytics WHERE timestamp < ?", [
				thirtyDaysAgo,
			]);
			console.log(
				`Analytics cleanup completed - removed records older than 30 days`,
			);
		}

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
	 * Records a request for analytics
	 * @param endpoint The endpoint that was accessed
	 * @param method HTTP method
	 * @param statusCode HTTP status code
	 * @param userAgent User agent string
	 * @param ipAddress IP address of the client
	 * @param responseTime Response time in milliseconds
	 */
	async recordRequest(
		endpoint: string,
		method: string,
		statusCode: number,
		userAgent?: string,
		ipAddress?: string,
		responseTime?: number,
	): Promise<void> {
		try {
			const id = crypto.randomUUID();
			this.db.run(
				`INSERT INTO request_analytics
         (id, endpoint, method, status_code, user_agent, ip_address, timestamp, response_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					id,
					endpoint,
					method,
					statusCode,
					userAgent || null,
					ipAddress || null,
					Date.now(),
					responseTime || null,
				],
			);
		} catch (error) {
			console.error("Error recording request analytics:", error);
		}
	}

	/**
	 * Gets request analytics statistics with performance optimizations
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
		// Check cache first
		const cacheKey = `analytics_${days}`;
		const cached = this.typedAnalyticsCache.getAnalyticsData(cacheKey);

		if (cached) {
			return cached;
		}
		const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;

		// Total requests (excluding stats endpoint)
		const totalResult = this.db
			.query(
				"SELECT COUNT(*) as count FROM request_analytics WHERE timestamp > ? AND endpoint != '/stats'",
			)
			.get(cutoffTime) as { count: number };

		// Stats endpoint requests (tracked separately)
		const statsResult = this.db
			.query(
				"SELECT COUNT(*) as count FROM request_analytics WHERE timestamp > ? AND endpoint = '/stats'",
			)
			.get(cutoffTime) as { count: number };

		// Get raw endpoint data and group them intelligently (excluding stats)
		const rawEndpointResults = this.db
			.query(
				`
         SELECT endpoint, COUNT(*) as count, AVG(response_time) as averageResponseTime
         FROM request_analytics
         WHERE timestamp > ? AND endpoint != '/stats'
         GROUP BY endpoint
         ORDER BY count DESC
       `,
			)
			.all(cutoffTime) as Array<{
			endpoint: string;
			count: number;
			averageResponseTime: number | null;
		}>;

		// Group endpoints intelligently
		const endpointGroups: Record<
			string,
			{ count: number; totalResponseTime: number; requestCount: number }
		> = {};

		for (const result of rawEndpointResults) {
			const endpoint = result.endpoint;
			let groupKey: string;

			if (endpoint === "/" || endpoint === "/dashboard") {
				groupKey = "Dashboard";
			} else if (endpoint === "/health") {
				groupKey = "Health Check";
			} else if (endpoint === "/swagger" || endpoint.startsWith("/swagger")) {
				groupKey = "API Documentation";
			} else if (endpoint === "/emojis") {
				groupKey = "Emoji List";
			} else if (endpoint.match(/^\/emojis\/[^/]+$/)) {
				groupKey = "Emoji Data";
			} else if (endpoint.match(/^\/emojis\/[^/]+\/r$/)) {
				groupKey = "Emoji Redirects";
			} else if (endpoint.match(/^\/users\/[^/]+$/)) {
				groupKey = "User Data";
			} else if (endpoint.match(/^\/users\/[^/]+\/r$/)) {
				groupKey = "User Redirects";
			} else if (endpoint.match(/^\/users\/[^/]+\/purge$/)) {
				groupKey = "Cache Management";
			} else if (endpoint === "/reset") {
				groupKey = "Cache Management";
			} else {
				// For any other endpoints, try to categorize them
				if (endpoint.includes("/users/") && endpoint.includes("/r")) {
					groupKey = "User Redirects";
				} else if (endpoint.includes("/users/")) {
					groupKey = "User Data";
				} else if (endpoint.includes("/emojis/") && endpoint.includes("/r")) {
					groupKey = "Emoji Redirects";
				} else if (endpoint.includes("/emojis/")) {
					groupKey = "Emoji Data";
				} else {
					groupKey = "Other";
				}
			}

			if (!endpointGroups[groupKey]) {
				endpointGroups[groupKey] = {
					count: 0,
					totalResponseTime: 0,
					requestCount: 0,
				};
			}

			// Defensive: Only update if groupKey exists (should always exist due to initialization above)
			const group = endpointGroups[groupKey];
			if (group) {
				group.count += result.count;
				if (
					result.averageResponseTime !== null &&
					result.averageResponseTime !== undefined
				) {
					group.totalResponseTime += result.averageResponseTime * result.count;
					group.requestCount += result.count;
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

		// Requests by status code with average response time (excluding stats)
		const statusResultsRaw = this.db
			.query(
				`
         SELECT status_code as status, COUNT(*) as count, AVG(response_time) as averageResponseTime
         FROM request_analytics
         WHERE timestamp > ? AND endpoint != '/stats'
         GROUP BY status_code
         ORDER BY count DESC
       `,
			)
			.all(cutoffTime) as Array<{
			status: number;
			count: number;
			averageResponseTime: number | null;
		}>;

		const statusResults = statusResultsRaw.map((s) => ({
			status: s.status,
			count: s.count,
			averageResponseTime: s.averageResponseTime ?? 0,
		}));

		// Requests over time - hourly for 1 day, daily for longer periods
		let timeResults: Array<{
			date: string;
			count: number;
			averageResponseTime: number;
		}>;

		if (days === 1) {
			// 15-minute intervals for last 24 hours (excluding stats)
			const intervalResultsRaw = this.db
				.query(
					`
           SELECT
             strftime('%Y-%m-%d %H:', datetime(timestamp / 1000, 'unixepoch')) ||
             CASE
               WHEN CAST(strftime('%M', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 15 THEN '00'
               WHEN CAST(strftime('%M', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 30 THEN '15'
               WHEN CAST(strftime('%M', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 45 THEN '30'
               ELSE '45'
             END as date,
             COUNT(*) as count,
             AVG(response_time) as averageResponseTime
           FROM request_analytics
           WHERE timestamp > ? AND endpoint != '/stats'
           GROUP BY strftime('%Y-%m-%d %H:', datetime(timestamp / 1000, 'unixepoch')) ||
             CASE
               WHEN CAST(strftime('%M', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 15 THEN '00'
               WHEN CAST(strftime('%M', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 30 THEN '15'
               WHEN CAST(strftime('%M', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 45 THEN '30'
               ELSE '45'
             END
           ORDER BY date ASC
         `,
				)
				.all(cutoffTime) as Array<{
				date: string;
				count: number;
				averageResponseTime: number | null;
			}>;

			timeResults = intervalResultsRaw.map((h) => ({
				date: h.date,
				count: h.count,
				averageResponseTime: h.averageResponseTime ?? 0,
			}));
		} else if (days <= 7) {
			// Hourly data for 7 days (excluding stats)
			const hourResultsRaw = this.db
				.query(
					`
           SELECT
             strftime('%Y-%m-%d %H:00', datetime(timestamp / 1000, 'unixepoch')) as date,
             COUNT(*) as count,
             AVG(response_time) as averageResponseTime
           FROM request_analytics
           WHERE timestamp > ? AND endpoint != '/stats'
           GROUP BY strftime('%Y-%m-%d %H:00', datetime(timestamp / 1000, 'unixepoch'))
           ORDER BY date ASC
         `,
				)
				.all(cutoffTime) as Array<{
				date: string;
				count: number;
				averageResponseTime: number | null;
			}>;

			timeResults = hourResultsRaw.map((h) => ({
				date: h.date,
				count: h.count,
				averageResponseTime: h.averageResponseTime ?? 0,
			}));
		} else {
			// 4-hour intervals for longer periods (excluding stats)
			const intervalResultsRaw = this.db
				.query(
					`
           SELECT
             strftime('%Y-%m-%d ', datetime(timestamp / 1000, 'unixepoch')) ||
             CASE
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 4 THEN '00:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 8 THEN '04:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 12 THEN '08:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 16 THEN '12:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 20 THEN '16:00'
               ELSE '20:00'
             END as date,
             COUNT(*) as count,
             AVG(response_time) as averageResponseTime
           FROM request_analytics
           WHERE timestamp > ? AND endpoint != '/stats'
           GROUP BY strftime('%Y-%m-%d ', datetime(timestamp / 1000, 'unixepoch')) ||
             CASE
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 4 THEN '00:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 8 THEN '04:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 12 THEN '08:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 16 THEN '12:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 20 THEN '16:00'
               ELSE '20:00'
             END
           ORDER BY date ASC
         `,
				)
				.all(cutoffTime) as Array<{
				date: string;
				count: number;
				averageResponseTime: number | null;
			}>;

			timeResults = intervalResultsRaw.map((d) => ({
				date: d.date,
				count: d.count,
				averageResponseTime: d.averageResponseTime ?? 0,
			}));
		}

		// Average response time (excluding stats)
		const avgResponseResult = this.db
			.query(
				`
         SELECT AVG(response_time) as avg
         FROM request_analytics
         WHERE timestamp > ? AND response_time IS NOT NULL AND endpoint != '/stats'
       `,
			)
			.get(cutoffTime) as { avg: number | null };

		// Top user agents (raw strings, excluding stats) - optimized with index hint
		const topUserAgents = this.db
			.query(
				`
         SELECT user_agent as userAgent, COUNT(*) as count
         FROM request_analytics INDEXED BY idx_request_analytics_user_agent
         WHERE timestamp > ? AND user_agent IS NOT NULL AND endpoint != '/stats'
         GROUP BY user_agent
         ORDER BY count DESC
         LIMIT 50
       `,
			)
			.all(cutoffTime) as Array<{ userAgent: string; count: number }>;

		// Enhanced Latency Analytics

		// Get all response times for percentile calculations (excluding stats)
		const responseTimes = this.db
			.query(
				`
         SELECT response_time
         FROM request_analytics
         WHERE timestamp > ? AND response_time IS NOT NULL AND endpoint != '/stats'
         ORDER BY response_time
       `,
			)
			.all(cutoffTime) as Array<{ response_time: number }>;

		// Calculate percentiles
		const calculatePercentile = (
			arr: number[],
			percentile: number,
		): number | null => {
			if (arr.length === 0) return null;
			const index = Math.ceil((percentile / 100) * arr.length) - 1;
			return arr[Math.max(0, index)] ?? 0;
		};

		const sortedTimes = responseTimes
			.map((r) => r.response_time)
			.sort((a, b) => a - b);
		const percentiles = {
			p50: calculatePercentile(sortedTimes, 50),
			p75: calculatePercentile(sortedTimes, 75),
			p90: calculatePercentile(sortedTimes, 90),
			p95: calculatePercentile(sortedTimes, 95),
			p99: calculatePercentile(sortedTimes, 99),
		};

		// Response time distribution
		const totalWithResponseTime = responseTimes.length;
		const distributionRanges = [
			{ min: 0, max: 50, label: "0-50ms" },
			{ min: 50, max: 100, label: "50-100ms" },
			{ min: 100, max: 200, label: "100-200ms" },
			{ min: 200, max: 500, label: "200-500ms" },
			{ min: 500, max: 1000, label: "500ms-1s" },
			{ min: 1000, max: 2000, label: "1-2s" },
			{ min: 2000, max: 5000, label: "2-5s" },
			{ min: 5000, max: Infinity, label: "5s+" },
		];

		const distribution = distributionRanges.map((range) => {
			const count = sortedTimes.filter(
				(time) => time >= range.min && time < range.max,
			).length;
			return {
				range: range.label,
				count,
				percentage:
					totalWithResponseTime > 0 ? (count / totalWithResponseTime) * 100 : 0,
			};
		});

		// Slowest endpoints (grouped)
		const slowestEndpoints = requestsByEndpoint
			.filter((e) => e.averageResponseTime > 0)
			.sort((a, b) => b.averageResponseTime - a.averageResponseTime)
			.slice(0, 10);

		// Latency over time - hourly for 1 day, daily for longer periods
		let latencyOverTime: Array<{
			time: string;
			averageResponseTime: number;
			p95: number | null;
			count: number;
		}>;

		if (days === 1) {
			// 15-minute intervals for last 24 hours (excluding stats)
			const latencyOverTimeRaw = this.db
				.query(
					`
           SELECT
             strftime('%Y-%m-%d %H:', datetime(timestamp / 1000, 'unixepoch')) ||
             CASE
               WHEN CAST(strftime('%M', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 15 THEN '00'
               WHEN CAST(strftime('%M', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 30 THEN '15'
               WHEN CAST(strftime('%M', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 45 THEN '30'
               ELSE '45'
             END as time,
             AVG(response_time) as averageResponseTime,
             COUNT(*) as count
           FROM request_analytics
           WHERE timestamp > ? AND response_time IS NOT NULL AND endpoint != '/stats'
           GROUP BY strftime('%Y-%m-%d %H:', datetime(timestamp / 1000, 'unixepoch')) ||
             CASE
               WHEN CAST(strftime('%M', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 15 THEN '00'
               WHEN CAST(strftime('%M', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 30 THEN '15'
               WHEN CAST(strftime('%M', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 45 THEN '30'
               ELSE '45'
             END
           ORDER BY time ASC
         `,
				)
				.all(cutoffTime) as Array<{
				time: string;
				averageResponseTime: number;
				count: number;
			}>;

			// For 15-minute intervals, we'll skip P95 calculation to improve performance
			latencyOverTime = latencyOverTimeRaw.map((intervalData) => ({
				time: intervalData.time,
				averageResponseTime: intervalData.averageResponseTime,
				p95: null, // Skip P95 for better performance with high granularity
				count: intervalData.count,
			}));
		} else if (days <= 7) {
			// Hourly latency data for 7 days (excluding stats)
			const latencyOverTimeRaw = this.db
				.query(
					`
           SELECT
             strftime('%Y-%m-%d %H:00', datetime(timestamp / 1000, 'unixepoch')) as time,
             AVG(response_time) as averageResponseTime,
             COUNT(*) as count
           FROM request_analytics
           WHERE timestamp > ? AND response_time IS NOT NULL AND endpoint != '/stats'
           GROUP BY strftime('%Y-%m-%d %H:00', datetime(timestamp / 1000, 'unixepoch'))
           ORDER BY time ASC
         `,
				)
				.all(cutoffTime) as Array<{
				time: string;
				averageResponseTime: number;
				count: number;
			}>;

			latencyOverTime = latencyOverTimeRaw.map((hourData) => ({
				time: hourData.time,
				averageResponseTime: hourData.averageResponseTime,
				p95: null, // Skip P95 for better performance
				count: hourData.count,
			}));
		} else {
			// 4-hour intervals for longer periods (excluding stats)
			const latencyOverTimeRaw = this.db
				.query(
					`
           SELECT
             strftime('%Y-%m-%d ', datetime(timestamp / 1000, 'unixepoch')) ||
             CASE
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 4 THEN '00:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 8 THEN '04:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 12 THEN '08:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 16 THEN '12:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 20 THEN '16:00'
               ELSE '20:00'
             END as time,
             AVG(response_time) as averageResponseTime,
             COUNT(*) as count
           FROM request_analytics
           WHERE timestamp > ? AND response_time IS NOT NULL AND endpoint != '/stats'
           GROUP BY strftime('%Y-%m-%d ', datetime(timestamp / 1000, 'unixepoch')) ||
             CASE
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 4 THEN '00:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 8 THEN '04:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 12 THEN '08:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 16 THEN '12:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 20 THEN '16:00'
               ELSE '20:00'
             END
           ORDER BY time ASC
         `,
				)
				.all(cutoffTime) as Array<{
				time: string;
				averageResponseTime: number;
				count: number;
			}>;

			latencyOverTime = latencyOverTimeRaw.map((intervalData) => ({
				time: intervalData.time,
				averageResponseTime: intervalData.averageResponseTime,
				p95: null, // Skip P95 for better performance
				count: intervalData.count,
			}));
		}

		// Performance Metrics
		const errorRequests = statusResults
			.filter((s) => s.status >= 400)
			.reduce((sum, s) => sum + s.count, 0);
		const errorRate =
			totalResult.count > 0 ? (errorRequests / totalResult.count) * 100 : 0;

		// Calculate throughput (requests per hour)
		const timeSpanHours = days * 24;
		const throughput = totalResult.count / timeSpanHours;

		// Calculate APDEX score (Application Performance Index)
		// Satisfied: <= 100ms, Tolerating: <= 400ms, Frustrated: > 400ms
		const satisfiedCount = sortedTimes.filter((t) => t <= 100).length;
		const toleratingCount = sortedTimes.filter(
			(t) => t > 100 && t <= 400,
		).length;
		const apdex =
			totalWithResponseTime > 0
				? (satisfiedCount + toleratingCount * 0.5) / totalWithResponseTime
				: 0;

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

		// Simulate uptime (would need actual monitoring data)
		const uptime = Math.max(0, 100 - errorRate * 2); // Simple approximation

		// Peak traffic analysis (excluding stats)
		const peakHourData = this.db
			.query(
				`
         SELECT
           strftime('%H:00', datetime(timestamp / 1000, 'unixepoch')) as hour,
           COUNT(*) as count
         FROM request_analytics
         WHERE timestamp > ? AND endpoint != '/stats'
         GROUP BY strftime('%H:00', datetime(timestamp / 1000, 'unixepoch'))
         ORDER BY count DESC
         LIMIT 1
       `,
			)
			.get(cutoffTime) as { hour: string; count: number } | null;

		const peakDayData = this.db
			.query(
				`
         SELECT
           DATE(timestamp / 1000, 'unixepoch') as day,
           COUNT(*) as count
         FROM request_analytics
         WHERE timestamp > ? AND endpoint != '/stats'
         GROUP BY DATE(timestamp / 1000, 'unixepoch')
         ORDER BY count DESC
         LIMIT 1
       `,
			)
			.get(cutoffTime) as { day: string; count: number } | null;

		// Traffic Overview - detailed route breakdown over time
		let trafficOverview: Array<{
			time: string;
			routes: Record<string, number>;
			total: number;
		}>;

		if (days === 1) {
			// Hourly route breakdown for last 24 hours
			const trafficRaw = this.db
				.query(
					`
           SELECT
             strftime('%Y-%m-%d %H:00', datetime(timestamp / 1000, 'unixepoch')) as time,
             endpoint,
             COUNT(*) as count
           FROM request_analytics
           WHERE timestamp > ? AND endpoint != '/stats'
           GROUP BY strftime('%Y-%m-%d %H:00', datetime(timestamp / 1000, 'unixepoch')), endpoint
           ORDER BY time ASC
         `,
				)
				.all(cutoffTime) as Array<{
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

				// Apply same grouping logic as endpoints
				let groupKey: string;
				const endpoint = row.endpoint;

				if (endpoint === "/" || endpoint === "/dashboard") {
					groupKey = "Dashboard";
				} else if (endpoint === "/health") {
					groupKey = "Health Check";
				} else if (endpoint === "/swagger" || endpoint.startsWith("/swagger")) {
					groupKey = "API Documentation";
				} else if (endpoint === "/emojis") {
					groupKey = "Emoji List";
				} else if (endpoint.match(/^\/emojis\/[^/]+$/)) {
					groupKey = "Emoji Data";
				} else if (endpoint.match(/^\/emojis\/[^/]+\/r$/)) {
					groupKey = "Emoji Redirects";
				} else if (endpoint.match(/^\/users\/[^/]+$/)) {
					groupKey = "User Data";
				} else if (endpoint.match(/^\/users\/[^/]+\/r$/)) {
					groupKey = "User Redirects";
				} else if (endpoint.match(/^\/users\/[^/]+\/purge$/)) {
					groupKey = "Cache Management";
				} else if (endpoint === "/reset") {
					groupKey = "Cache Management";
				} else {
					// For any other endpoints, try to categorize them
					if (endpoint.includes("/users/") && endpoint.includes("/r")) {
						groupKey = "User Redirects";
					} else if (endpoint.includes("/users/")) {
						groupKey = "User Data";
					} else if (endpoint.includes("/emojis/") && endpoint.includes("/r")) {
						groupKey = "Emoji Redirects";
					} else if (endpoint.includes("/emojis/")) {
						groupKey = "Emoji Data";
					} else {
						groupKey = "Other";
					}
				}

				const group = timeGroups[row.time];

				if (group) {
					group[groupKey] = (group[groupKey] || 0) + row.count;
				}
			}

			trafficOverview = Object.entries(timeGroups)
				.map(([time, routes]) => ({
					time,
					routes,
					total: Object.values(routes).reduce((sum, count) => sum + count, 0),
				}))
				.sort((a, b) => a.time.localeCompare(b.time));
		} else if (days <= 7) {
			// 4-hour intervals for 7 days
			const trafficRaw = this.db
				.query(
					`
           SELECT
             strftime('%Y-%m-%d %H:00', datetime(timestamp / 1000, 'unixepoch')) as hour,
             endpoint,
             COUNT(*) as count
           FROM request_analytics
           WHERE timestamp > ? AND endpoint != '/stats'
           GROUP BY strftime('%Y-%m-%d %H:00', datetime(timestamp / 1000, 'unixepoch')), endpoint
           ORDER BY hour ASC
         `,
				)
				.all(cutoffTime) as Array<{
				hour: string;
				endpoint: string;
				count: number;
			}>;

			// Group into 4-hour intervals
			const intervalGroups: Record<string, Record<string, number>> = {};
			for (const row of trafficRaw) {
				const hourStr = row.hour?.split(" ")[1]?.split(":")[0];
				const hour = hourStr ? parseInt(hourStr, 10) : 0;
				const intervalHour = Math.floor(hour / 4) * 4;
				const intervalTime =
					row.hour.split(" ")[0] +
					` ${intervalHour.toString().padStart(2, "0")}:00`;

				if (!intervalGroups[intervalTime]) {
					intervalGroups[intervalTime] = {};
				}

				// Apply same grouping logic
				let groupKey: string;
				const endpoint = row.endpoint;

				if (endpoint === "/" || endpoint === "/dashboard") {
					groupKey = "Dashboard";
				} else if (endpoint === "/health") {
					groupKey = "Health Check";
				} else if (endpoint === "/swagger" || endpoint.startsWith("/swagger")) {
					groupKey = "API Documentation";
				} else if (endpoint === "/emojis") {
					groupKey = "Emoji List";
				} else if (endpoint.match(/^\/emojis\/[^/]+$/)) {
					groupKey = "Emoji Data";
				} else if (endpoint.match(/^\/emojis\/[^/]+\/r$/)) {
					groupKey = "Emoji Redirects";
				} else if (endpoint.match(/^\/users\/[^/]+$/)) {
					groupKey = "User Data";
				} else if (endpoint.match(/^\/users\/[^/]+\/r$/)) {
					groupKey = "User Redirects";
				} else if (endpoint.match(/^\/users\/[^/]+\/purge$/)) {
					groupKey = "Cache Management";
				} else if (endpoint === "/reset") {
					groupKey = "Cache Management";
				} else {
					// For any other endpoints, try to categorize them
					if (endpoint.includes("/users/") && endpoint.includes("/r")) {
						groupKey = "User Redirects";
					} else if (endpoint.includes("/users/")) {
						groupKey = "User Data";
					} else if (endpoint.includes("/emojis/") && endpoint.includes("/r")) {
						groupKey = "Emoji Redirects";
					} else if (endpoint.includes("/emojis/")) {
						groupKey = "Emoji Data";
					} else {
						groupKey = "Other";
					}
				}

				intervalGroups[intervalTime][groupKey] =
					(intervalGroups[intervalTime][groupKey] || 0) + row.count;
			}

			trafficOverview = Object.entries(intervalGroups)
				.map(([time, routes]) => ({
					time,
					routes,
					total: Object.values(routes).reduce((sum, count) => sum + count, 0),
				}))
				.sort((a, b) => a.time.localeCompare(b.time));
		} else {
			// Daily breakdown for longer periods
			const trafficRaw = this.db
				.query(
					`
           SELECT
             DATE(timestamp / 1000, 'unixepoch') as time,
             endpoint,
             COUNT(*) as count
           FROM request_analytics
           WHERE timestamp > ? AND endpoint != '/stats'
           GROUP BY DATE(timestamp / 1000, 'unixepoch'), endpoint
           ORDER BY time ASC
         `,
				)
				.all(cutoffTime) as Array<{
				time: string;
				endpoint: string;
				count: number;
			}>;

			// Group by day
			const dayGroups: Record<string, Record<string, number>> = {};
			for (const row of trafficRaw) {
				if (!dayGroups[row.time]) {
					dayGroups[row.time] = {};
				}

				// Apply same grouping logic
				let groupKey: string;
				const endpoint = row.endpoint;

				if (endpoint === "/" || endpoint === "/dashboard") {
					groupKey = "Dashboard";
				} else if (endpoint === "/health") {
					groupKey = "Health Check";
				} else if (endpoint === "/swagger" || endpoint.startsWith("/swagger")) {
					groupKey = "API Documentation";
				} else if (endpoint === "/emojis") {
					groupKey = "Emoji List";
				} else if (endpoint.match(/^\/emojis\/[^/]+$/)) {
					groupKey = "Emoji Data";
				} else if (endpoint.match(/^\/emojis\/[^/]+\/r$/)) {
					groupKey = "Emoji Redirects";
				} else if (endpoint.match(/^\/users\/[^/]+$/)) {
					groupKey = "User Data";
				} else if (endpoint.match(/^\/users\/[^/]+\/r$/)) {
					groupKey = "User Redirects";
				} else if (endpoint.match(/^\/users\/[^/]+\/purge$/)) {
					groupKey = "Cache Management";
				} else if (endpoint === "/reset") {
					groupKey = "Cache Management";
				} else {
					// For any other endpoints, try to categorize them
					if (endpoint.includes("/users/") && endpoint.includes("/r")) {
						groupKey = "User Redirects";
					} else if (endpoint.includes("/users/")) {
						groupKey = "User Data";
					} else if (endpoint.includes("/emojis/") && endpoint.includes("/r")) {
						groupKey = "Emoji Redirects";
					} else if (endpoint.includes("/emojis/")) {
						groupKey = "Emoji Data";
					} else {
						groupKey = "Other";
					}
				}
				const group = dayGroups[row.time];
				if (group) {
					group[groupKey] = (group[groupKey] || 0) + row.count;
				}
			}

			trafficOverview = Object.entries(dayGroups)
				.map(([time, routes]) => ({
					time,
					routes,
					total: Object.values(routes).reduce((sum, count) => sum + count, 0),
				}))
				.sort((a, b) => a.time.localeCompare(b.time));
		}

		const result = {
			totalRequests: totalResult.count,
			requestsByEndpoint: requestsByEndpoint,
			requestsByStatus: statusResults,
			requestsByDay: timeResults,
			averageResponseTime: avgResponseResult.avg,
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
				totalWithStats: totalResult.count + statsResult.count,
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
		// Check cache first
		const cacheKey = `essential_${days}`;
		const cached = this.typedAnalyticsCache.getEssentialStatsData(cacheKey);

		if (cached) {
			return cached;
		}

		const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;

		// Total requests (excluding stats endpoint) - fastest query
		const totalResult = this.db
			.query(
				"SELECT COUNT(*) as count FROM request_analytics WHERE timestamp > ? AND endpoint != '/stats'",
			)
			.get(cutoffTime) as { count: number };

		// Average response time (excluding stats) - simple query
		const avgResponseResult = this.db
			.query(
				"SELECT AVG(response_time) as avg FROM request_analytics WHERE timestamp > ? AND response_time IS NOT NULL AND endpoint != '/stats'",
			)
			.get(cutoffTime) as { avg: number | null };

		// Simple error rate calculation for uptime
		const errorRequests = this.db
			.query(
				"SELECT COUNT(*) as count FROM request_analytics WHERE timestamp > ? AND status_code >= 400 AND endpoint != '/stats'",
			)
			.get(cutoffTime) as { count: number };

		const errorRate =
			totalResult.count > 0
				? (errorRequests.count / totalResult.count) * 100
				: 0;
		const uptime = Math.max(0, 100 - errorRate * 2); // Simple approximation

		const result = {
			totalRequests: totalResult.count,
			averageResponseTime: avgResponseResult.avg,
			uptime: uptime,
		};

		// Cache the result
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
		// Check cache first
		const cacheKey = `charts_${days}`;
		const cached = this.typedAnalyticsCache.getChartData(cacheKey);

		if (cached) {
			return cached;
		}

		const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;

		// Reuse the existing time logic from getAnalytics
		let timeResults: Array<{
			date: string;
			count: number;
			averageResponseTime: number;
		}>;

		if (days === 1) {
			// 15-minute intervals for last 24 hours (excluding stats)
			const intervalResultsRaw = this.db
				.query(
					`
           SELECT
             strftime('%Y-%m-%d %H:', datetime(timestamp / 1000, 'unixepoch')) ||
             CASE
               WHEN CAST(strftime('%M', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 15 THEN '00'
               WHEN CAST(strftime('%M', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 30 THEN '15'
               WHEN CAST(strftime('%M', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 45 THEN '30'
               ELSE '45'
             END as date,
             COUNT(*) as count,
             AVG(response_time) as averageResponseTime
           FROM request_analytics
           WHERE timestamp > ? AND endpoint != '/stats'
           GROUP BY strftime('%Y-%m-%d %H:', datetime(timestamp / 1000, 'unixepoch')) ||
             CASE
               WHEN CAST(strftime('%M', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 15 THEN '00'
               WHEN CAST(strftime('%M', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 30 THEN '15'
               WHEN CAST(strftime('%M', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 45 THEN '30'
               ELSE '45'
             END
           ORDER BY date ASC
         `,
				)
				.all(cutoffTime) as Array<{
				date: string;
				count: number;
				averageResponseTime: number | null;
			}>;

			timeResults = intervalResultsRaw.map((h) => ({
				date: h.date,
				count: h.count,
				averageResponseTime: h.averageResponseTime ?? 0,
			}));
		} else if (days <= 7) {
			// Hourly data for 7 days (excluding stats)
			const hourResultsRaw = this.db
				.query(
					`
           SELECT
             strftime('%Y-%m-%d %H:00', datetime(timestamp / 1000, 'unixepoch')) as date,
             COUNT(*) as count,
             AVG(response_time) as averageResponseTime
           FROM request_analytics
           WHERE timestamp > ? AND endpoint != '/stats'
           GROUP BY strftime('%Y-%m-%d %H:00', datetime(timestamp / 1000, 'unixepoch'))
           ORDER BY date ASC
         `,
				)
				.all(cutoffTime) as Array<{
				date: string;
				count: number;
				averageResponseTime: number | null;
			}>;

			timeResults = hourResultsRaw.map((h) => ({
				date: h.date,
				count: h.count,
				averageResponseTime: h.averageResponseTime ?? 0,
			}));
		} else {
			// 4-hour intervals for longer periods (excluding stats)
			const intervalResultsRaw = this.db
				.query(
					`
           SELECT
             strftime('%Y-%m-%d ', datetime(timestamp / 1000, 'unixepoch')) ||
             CASE
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 4 THEN '00:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 8 THEN '04:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 12 THEN '08:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 16 THEN '12:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 20 THEN '16:00'
               ELSE '20:00'
             END as date,
             COUNT(*) as count,
             AVG(response_time) as averageResponseTime
           FROM request_analytics
           WHERE timestamp > ? AND endpoint != '/stats'
           GROUP BY strftime('%Y-%m-%d ', datetime(timestamp / 1000, 'unixepoch')) ||
             CASE
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 4 THEN '00:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 8 THEN '04:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 12 THEN '08:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 16 THEN '12:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 20 THEN '16:00'
               ELSE '20:00'
             END
           ORDER BY date ASC
         `,
				)
				.all(cutoffTime) as Array<{
				date: string;
				count: number;
				averageResponseTime: number | null;
			}>;

			timeResults = intervalResultsRaw.map((d) => ({
				date: d.date,
				count: d.count,
				averageResponseTime: d.averageResponseTime ?? 0,
			}));
		}

		// Latency over time data (reuse from getAnalytics)
		let latencyOverTime: Array<{
			time: string;
			averageResponseTime: number;
			p95: number | null;
			count: number;
		}>;

		if (days === 1) {
			const latencyOverTimeRaw = this.db
				.query(
					`
           SELECT
             strftime('%Y-%m-%d %H:', datetime(timestamp / 1000, 'unixepoch')) ||
             CASE
               WHEN CAST(strftime('%M', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 15 THEN '00'
               WHEN CAST(strftime('%M', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 30 THEN '15'
               WHEN CAST(strftime('%M', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 45 THEN '30'
               ELSE '45'
             END as time,
             AVG(response_time) as averageResponseTime,
             COUNT(*) as count
           FROM request_analytics
           WHERE timestamp > ? AND response_time IS NOT NULL AND endpoint != '/stats'
           GROUP BY strftime('%Y-%m-%d %H:', datetime(timestamp / 1000, 'unixepoch')) ||
             CASE
               WHEN CAST(strftime('%M', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 15 THEN '00'
               WHEN CAST(strftime('%M', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 30 THEN '15'
               WHEN CAST(strftime('%M', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 45 THEN '30'
               ELSE '45'
             END
           ORDER BY time ASC
         `,
				)
				.all(cutoffTime) as Array<{
				time: string;
				averageResponseTime: number;
				count: number;
			}>;

			latencyOverTime = latencyOverTimeRaw.map((intervalData) => ({
				time: intervalData.time,
				averageResponseTime: intervalData.averageResponseTime,
				p95: null, // Skip P95 for better performance
				count: intervalData.count,
			}));
		} else if (days <= 7) {
			const latencyOverTimeRaw = this.db
				.query(
					`
           SELECT
             strftime('%Y-%m-%d %H:00', datetime(timestamp / 1000, 'unixepoch')) as time,
             AVG(response_time) as averageResponseTime,
             COUNT(*) as count
           FROM request_analytics
           WHERE timestamp > ? AND response_time IS NOT NULL AND endpoint != '/stats'
           GROUP BY strftime('%Y-%m-%d %H:00', datetime(timestamp / 1000, 'unixepoch'))
           ORDER BY time ASC
         `,
				)
				.all(cutoffTime) as Array<{
				time: string;
				averageResponseTime: number;
				count: number;
			}>;

			latencyOverTime = latencyOverTimeRaw.map((hourData) => ({
				time: hourData.time,
				averageResponseTime: hourData.averageResponseTime,
				p95: null, // Skip P95 for better performance
				count: hourData.count,
			}));
		} else {
			const latencyOverTimeRaw = this.db
				.query(
					`
           SELECT
             strftime('%Y-%m-%d ', datetime(timestamp / 1000, 'unixepoch')) ||
             CASE
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 4 THEN '00:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 8 THEN '04:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 12 THEN '08:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 16 THEN '12:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 20 THEN '16:00'
               ELSE '20:00'
             END as time,
             AVG(response_time) as averageResponseTime,
             COUNT(*) as count
           FROM request_analytics
           WHERE timestamp > ? AND response_time IS NOT NULL AND endpoint != '/stats'
           GROUP BY strftime('%Y-%m-%d ', datetime(timestamp / 1000, 'unixepoch')) ||
             CASE
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 4 THEN '00:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 8 THEN '04:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 12 THEN '08:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 16 THEN '12:00'
               WHEN CAST(strftime('%H', datetime(timestamp / 1000, 'unixepoch')) AS INTEGER) < 20 THEN '16:00'
               ELSE '20:00'
             END
           ORDER BY time ASC
         `,
				)
				.all(cutoffTime) as Array<{
				time: string;
				averageResponseTime: number;
				count: number;
			}>;

			latencyOverTime = latencyOverTimeRaw.map((intervalData) => ({
				time: intervalData.time,
				averageResponseTime: intervalData.averageResponseTime,
				p95: null, // Skip P95 for better performance
				count: intervalData.count,
			}));
		}

		const result = {
			requestsByDay: timeResults,
			latencyOverTime: latencyOverTime,
		};

		// Cache the result
		this.typedAnalyticsCache.setChartData(cacheKey, result);

		return result;
	}

	/**
	 * Gets user agents data only (slowest loading)
	 * @param days Number of days to look back (default: 7)
	 * @returns User agents data
	 */
	async getUserAgents(
		days: number = 7,
	): Promise<Array<{ userAgent: string; count: number }>> {
		// Check cache first
		const cacheKey = `useragents_${days}`;
		const cached = this.typedAnalyticsCache.getUserAgentData(cacheKey);

		if (cached) {
			return cached;
		}

		const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;

		// Top user agents (raw strings, excluding stats) - optimized with index hint
		const topUserAgents = this.db
			.query(
				`
         SELECT user_agent as userAgent, COUNT(*) as count
         FROM request_analytics INDEXED BY idx_request_analytics_user_agent
         WHERE timestamp > ? AND user_agent IS NOT NULL AND endpoint != '/stats'
         GROUP BY user_agent
         ORDER BY count DESC
         LIMIT 50
       `,
			)
			.all(cutoffTime) as Array<{ userAgent: string; count: number }>;

		// Cache the result
		this.typedAnalyticsCache.setUserAgentData(cacheKey, topUserAgents);

		return topUserAgents;
	}
}

export { Cache as SlackCache };
