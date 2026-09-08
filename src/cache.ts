import { type ScheduledTask, schedule } from "node-cron";
import { type DatabaseOptions, createDb, initSchema } from "./db";
import { asNumber } from "./db/dialect";
import type { Db } from "./db/types";
import { AnalyticsQueryService } from "./lib/analytics-queries";
import { HealthMonitor } from "./lib/health-monitor";
import { bucketAnalyticsMigration } from "./migrations/bucketAnalyticsMigration";
import { endpointGroupingMigration } from "./migrations/endpointGroupingMigration";
import { logGroupingMigration } from "./migrations/logGroupingMigration";
import { MigrationManager } from "./migrations/migrationManager";
import type {
	ChartData,
	EssentialStatsData,
	FullAnalyticsData,
} from "./types/analytics";
import type { Emoji, SlackUserProvider, User } from "./types/cache-entities";

export type {
	ChartData,
	DashboardMetrics,
	DayMetrics,
	EndpointMetrics,
	EssentialStatsData,
	FullAnalyticsData,
	LatencyAnalytics,
	LatencyDistribution,
	LatencyOverTimeMetrics,
	LatencyPercentiles,
	PeakTraffic,
	PerformanceMetrics,
	StatusMetrics,
	TrafficOverview,
	UserAgentData,
	UserAgentMetrics,
} from "./types/analytics";
// Re-export types for backward compatibility
export type { Emoji, SlackUserProvider, User } from "./types/cache-entities";

const SECONDS_PER_10MIN = 600;
const SECONDS_PER_DAY = 86400;
const MS_PER_HOUR = 3600000;
const USER_DEFAULT_TTL_HOURS = 7 * 24;
const USER_CLEANUP_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const TOUCH_REFRESH_MIN_MS = 2 * 60 * 60 * 1000; // 2 hours
const TOUCH_REFRESH_MAX_MS = 24 * 60 * 60 * 1000; // 24 hours
const PRESSURE_EMA_ALPHA = 0.3; // smoothing factor: lower = slower to react
const QUEUE_BATCH_SIZE = 10;
const QUEUE_INTERVAL_MS = 5 * 1000;
const LRU_MAX_SIZE = 2000;
const LRU_TTL_MS = 60_000;

/** Columns of `users`, with the epoch-ms expiration forced to a JS number. */
const USER_COLUMNS = `id, "userId", "displayName", "realName", pronouns, "imageUrl", ${asNumber("expiration")} AS expiration`;
/** Columns of `emojis`, with the epoch-ms expiration forced to a JS number. */
const EMOJI_COLUMNS = `id, name, alias, "imageUrl", ${asNumber("expiration")} AS expiration`;

/**
 * Cache class for storing user and emoji data with automatic expiration.
 * Composes AnalyticsQueryService and HealthMonitor for separation of concerns.
 *
 * Construct with `SlackCache.create()`: opening the database and running
 * migrations are async, so they cannot happen in a constructor.
 */
class Cache {
	private db: Db;
	private defaultExpiration: number; // in hours
	private onEmojiExpired?: () => void;

	// Background user update queue to avoid Slack API limits
	// Priority queue: newUserQueue (misses) processed before refreshQueue (touch-refreshes)
	private newUserQueue: Set<string> = new Set();
	private refreshQueue: Set<string> = new Set();
	private isProcessingQueue = false;
	private slackWrapper?: SlackUserProvider;

	// Queue pressure tracking: EMA of (ingress / drain) per tick
	// 1.0 = keeping up, >1.0 = falling behind, <1.0 = catching up
	private queuePressure = 1.0;
	private tickIngress = 0;

	// Composed services
	private analytics: AnalyticsQueryService;
	private healthMonitor: HealthMonitor;

	// Scheduled task handles for cleanup
	private cronTasks: ScheduledTask[] = [];
	private queueIntervalId?: ReturnType<typeof setInterval>;

	// In-memory LRU caches (Map preserves insertion order)
	private userCache = new Map<string, { data: User; ts: number }>();
	private emojiCache = new Map<string, { data: Emoji; ts: number }>();

	private constructor(
		db: Db,
		defaultExpirationHours: number,
		onEmojiExpired?: () => void,
	) {
		this.db = db;
		this.defaultExpiration = defaultExpirationHours;
		this.onEmojiExpired = onEmojiExpired;

		this.analytics = new AnalyticsQueryService(this.db);
		this.healthMonitor = new HealthMonitor(this.db, () => ({
			newUser: this.newUserQueue.size,
			refresh: this.refreshQueue.size,
		}));
	}

	/**
	 * Opens the configured database, creates the schema, runs migrations and
	 * starts the background schedules.
	 */
	static async create(
		database: DatabaseOptions | string,
		defaultExpirationHours = 24,
		onEmojiExpired?: () => void,
	): Promise<Cache> {
		// A bare string is treated as a SQLite path, which keeps the old
		// `new SlackCache("./data/cachet.db")` shape working for tests.
		const options: DatabaseOptions =
			typeof database === "string" ? { path: database } : database;

		const db = createDb(options);
		const cache = new Cache(db, defaultExpirationHours, onEmojiExpired);

		await initSchema(db);
		await cache.runMigrations();

		await cache.healthMonitor.startUptimeSession();
		cache.setupPurgeSchedule();
		cache.startQueueProcessor();

		return cache;
	}

	/**
	 * Triggers the emoji refresh callback when no unexpired emojis are cached.
	 *
	 * Kept separate from `create()` so the callback -- which normally writes
	 * back through this same instance -- only ever runs after construction has
	 * returned.
	 */
	async seedEmojisIfEmpty(): Promise<void> {
		if (!this.onEmojiExpired) return;

		const result = await this.db.get<{ count: number }>(
			`SELECT ${asNumber("COUNT(*)")} as count FROM emojis WHERE expiration > ?`,
			[Date.now()],
		);
		if ((result?.count ?? 0) === 0) {
			this.onEmojiExpired();
		}
	}

	private setupPurgeSchedule() {
		const cronOptions = { timezone: "Etc/UTC" };

		this.cronTasks.push(
			schedule(
				"45 * * * *",
				async () => {
					try {
						await this.purgeExpiredItems();
						await this.lazyUserCleanup();
					} catch (error) {
						console.error("Error during purge schedule:", error);
					}
				},
				cronOptions,
			),
		);

		this.cronTasks.push(
			schedule(
				"0 * * * *",
				async () => {
					try {
						console.log("Scheduled emoji update starting...");
						if (this.onEmojiExpired) {
							await this.onEmojiExpired();
							console.log("Scheduled emoji update completed");
						}
					} catch (error) {
						console.error("Error during emoji update schedule:", error);
					}
				},
				cronOptions,
			),
		);

		// Postgres autovacuums; a manual VACUUM there would only add load.
		if (this.db.dialect === "sqlite") {
			this.cronTasks.push(
				schedule(
					"0 8 * * *",
					async () => {
						try {
							console.log("Running scheduled VACUUM...");
							await this.db.run("VACUUM");
							console.log("VACUUM completed");
						} catch (error) {
							console.error("Error during VACUUM:", error);
						}
					},
					cronOptions,
				),
			);
		}
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
		const result2 = await this.db.run(
			"DELETE FROM emojis WHERE expiration < ?",
			[Date.now()],
		);

		this.emojiCache.clear();

		const oneDayAgoSec = Math.floor(Date.now() / 1000) - SECONDS_PER_DAY;
		const cleanupBucket = oneDayAgoSec - (oneDayAgoSec % SECONDS_PER_10MIN);
		await this.db.run("DELETE FROM traffic_10min WHERE bucket < ?", [
			cleanupBucket,
		]);

		return result2.changes;
	}

	private async lazyUserCleanup(): Promise<void> {
		const currentHour = new Date().getUTCHours();
		if (currentHour >= 8 && currentHour < 10 && Math.random() < 0.1) {
			const sevenDaysAgo = Date.now() - USER_CLEANUP_AGE_MS;
			const result = await this.db.run(
				"DELETE FROM users WHERE expiration < ?",
				[sevenDaysAgo],
			);
			if (result.changes > 0) {
				console.log(
					`Lazy user cleanup: removed ${result.changes} expired users`,
				);
			}
		}
	}

	async purgeUserCache(userId: string): Promise<boolean> {
		try {
			const normalizedId = userId.toUpperCase();
			const result = await this.db.run(`DELETE FROM users WHERE "userId" = ?`, [
				normalizedId,
			]);
			this.userCache.delete(normalizedId);
			return result.changes > 0;
		} catch (error) {
			console.error("Error purging user cache:", error);
			return false;
		}
	}

	async purgeEmojis(): Promise<number> {
		try {
			const result = await this.db.run("DELETE FROM emojis");
			this.emojiCache.clear();
			if (this.onEmojiExpired && result.changes > 0) {
				this.onEmojiExpired();
			}
			return result.changes;
		} catch (error) {
			console.error("Error purging emojis:", error);
			return 0;
		}
	}

	async purgeAll(): Promise<{
		message: string;
		users: number;
		emojis: number;
	}> {
		const result = await this.db.run("DELETE FROM users");
		const result2 = await this.db.run("DELETE FROM emojis");

		this.userCache.clear();
		this.emojiCache.clear();

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

	async endUptimeSession() {
		await this.healthMonitor.endUptimeSession();
	}

	async getUptime(): Promise<number> {
		return this.healthMonitor.getUptime();
	}

	// --- Slack wrapper injection ---

	setSlackWrapper(slackWrapper: SlackUserProvider) {
		this.slackWrapper = slackWrapper;
		this.healthMonitor.setSlackWrapper(slackWrapper);
	}

	// --- User update queue ---

	/**
	 * Computes a dynamic touch-refresh threshold based on queue pressure.
	 * Pressure ~1.0 (keeping up) → 2h threshold for fast pfp updates.
	 * Pressure >1.5 (falling behind) → scales toward 24h.
	 * Uses EMA-smoothed ingress/drain ratio to avoid flapping.
	 */
	private getTouchRefreshThreshold(): number {
		if (this.queuePressure <= 1.0) return TOUCH_REFRESH_MIN_MS;
		if (this.queuePressure >= 2.0) return TOUCH_REFRESH_MAX_MS;
		const ratio = this.queuePressure - 1.0; // 0..1 over the 1.0..2.0 range
		return (
			TOUCH_REFRESH_MIN_MS +
			ratio * (TOUCH_REFRESH_MAX_MS - TOUCH_REFRESH_MIN_MS)
		);
	}

	queueUserUpdate(userId: string, priority: "new" | "refresh" = "new") {
		const normalizedId = userId.toUpperCase();
		const alreadyQueued =
			this.newUserQueue.has(normalizedId) ||
			this.refreshQueue.has(normalizedId);
		if (!alreadyQueued) {
			this.tickIngress++;
		}
		const targetQueue =
			priority === "new" ? this.newUserQueue : this.refreshQueue;
		targetQueue.add(normalizedId);
	}

	private startQueueProcessor() {
		this.queueIntervalId = setInterval(async () => {
			await this.processUserUpdateQueue();
		}, QUEUE_INTERVAL_MS);
	}

	/** Extends a user's TTL without making the read path wait on the write. */
	private flushTouchRefresh(newExpiration: number, normalizedId: string) {
		this.db
			.run(`UPDATE users SET expiration = ? WHERE "userId" = ?`, [
				newExpiration,
				normalizedId,
			])
			.catch((error) => {
				console.error("Error in touch-refresh update:", error);
			});
	}

	private async processUserUpdateQueue() {
		const totalSize = this.newUserQueue.size + this.refreshQueue.size;
		if (this.isProcessingQueue || totalSize === 0 || !this.slackWrapper) {
			return;
		}

		this.isProcessingQueue = true;

		const slack = this.slackWrapper;
		if (!slack) return;

		try {
			// Snapshot and reset ingress/drain counters at tick start
			// to avoid accumulating across skipped ticks
			const tickIngress = this.tickIngress;
			this.tickIngress = 0;

			// Interleave: 2 new users for every 1 refresh, preferring new users
			const newUsers = Array.from(this.newUserQueue);
			const refreshUsers = Array.from(this.refreshQueue);
			const batch: string[] = [];
			let ni = 0;
			let ri = 0;

			while (
				batch.length < QUEUE_BATCH_SIZE &&
				(ni < newUsers.length || ri < refreshUsers.length)
			) {
				const pickNew =
					ri >= refreshUsers.length ||
					(ni < newUsers.length && batch.length % 3 !== 2);
				if (pickNew && ni < newUsers.length) {
					const user = newUsers[ni];
					if (user) {
						batch.push(user);
						ni++;
					}
				} else if (ri < refreshUsers.length) {
					const user = refreshUsers[ri];
					if (user) {
						batch.push(user);
						ri++;
					}
				} else if (ni < newUsers.length) {
					const user = newUsers[ni];
					if (user) {
						batch.push(user);
						ni++;
					}
				}
			}

			const results = await Promise.allSettled(
				batch.map(async (userId) => {
					console.log(`Background updating user: ${userId}`);
					const slackUser = await slack.getUserInfo(userId);
					if (!slackUser) {
						console.warn(`Slack returned no user for ${userId}`);
						return userId;
					}

					const displayName =
						slackUser.profile?.display_name ||
						slackUser.real_name ||
						slackUser.name ||
						"";
					const realName =
						slackUser.real_name || slackUser.profile?.display_name || "";

					await this.insertUser(
						userId.toUpperCase(),
						displayName,
						realName,
						slackUser.profile?.pronouns || "",
						slackUser.profile?.image_512 || slackUser.profile?.image_192 || "",
					);

					return userId;
				}),
			);

			// Update pressure EMA using this tick's counters
			let drained = 0;
			for (const result of results) {
				if (result.status === "fulfilled") {
					this.newUserQueue.delete(result.value);
					this.refreshQueue.delete(result.value);
					drained++;
				} else {
					console.warn("Failed to update user:", result.reason);
				}
			}

			if (drained > 0) {
				const rawRatio = tickIngress / drained;
				this.queuePressure =
					PRESSURE_EMA_ALPHA * rawRatio +
					(1 - PRESSURE_EMA_ALPHA) * this.queuePressure;
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
		realName: string,
		pronouns: string,
		imageUrl: string,
		expirationHours?: number,
	) {
		const id = crypto.randomUUID();
		const userDefaultTTL = USER_DEFAULT_TTL_HOURS;
		const expiration =
			Date.now() + (expirationHours || userDefaultTTL) * MS_PER_HOUR;

		try {
			await this.db.run(
				`INSERT INTO users (id, "userId", "displayName", "realName", pronouns, "imageUrl", expiration)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
           ON CONFLICT("userId")
           DO UPDATE SET "displayName" = ?3, "realName" = ?4, pronouns = ?5, "imageUrl" = ?6, expiration = ?7`,
				[
					id,
					userId.toUpperCase(),
					displayName,
					realName,
					pronouns,
					imageUrl,
					expiration,
				],
			);
			this.userCache.delete(userId.toUpperCase());
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
			await this.db.run(
				`INSERT INTO emojis (id, name, alias, "imageUrl", expiration)
          VALUES (?1, ?2, ?3, ?4, ?5)
          ON CONFLICT(name)
          DO UPDATE SET "imageUrl" = ?4, expiration = ?5`,
				[
					id,
					name.toLowerCase(),
					alias?.toLowerCase() || null,
					imageUrl,
					expiration,
				],
			);
			this.emojiCache.delete(name.toLowerCase());
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

			await this.db.transaction(async (tx) => {
				for (const emoji of emojis) {
					await tx.run(
						`INSERT INTO emojis (id, name, alias, "imageUrl", expiration)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(name)
             DO UPDATE SET "imageUrl" = ?4, expiration = ?5`,
						[
							crypto.randomUUID(),
							emoji.name.toLowerCase(),
							emoji.alias?.toLowerCase() || null,
							emoji.imageUrl,
							expiration,
						],
					);
				}
			});

			this.emojiCache.clear();
			return true;
		} catch (error) {
			console.error("Error batch inserting emojis:", error);
			return false;
		}
	}

	async getUser(userId: string): Promise<User | null> {
		const normalizedId = userId.toUpperCase();
		const now = Date.now();

		// Check in-memory LRU cache
		const cached = this.userCache.get(normalizedId);
		if (cached) {
			if (now - cached.ts < LRU_TTL_MS) {
				// Move to end (most recently used)
				this.userCache.delete(normalizedId);
				this.userCache.set(normalizedId, cached);
				return cached.data;
			}
			// Expired from LRU
			this.userCache.delete(normalizedId);
		}

		const result = await this.db.get<User>(
			`SELECT ${USER_COLUMNS} FROM users WHERE "userId" = ?`,
			[normalizedId],
		);

		if (!result) {
			return null;
		}

		const expiration = new Date(result.expiration).getTime();

		if (expiration < now) {
			await this.db.run(`DELETE FROM users WHERE "userId" = ?`, [normalizedId]);
			return null;
		}

		const threshold = this.getTouchRefreshThreshold();
		const thresholdAgo = now - threshold;
		const userAge = expiration - USER_CLEANUP_AGE_MS;

		if (userAge < thresholdAgo) {
			const newExpiration = now + USER_CLEANUP_AGE_MS;
			this.flushTouchRefresh(newExpiration, normalizedId);
			this.queueUserUpdate(normalizedId, "refresh");
			console.log(
				`Touch-refresh: Extended TTL for user ${normalizedId} and queued for update`,
			);
		}

		const user: User = {
			type: "user",
			id: result.id,
			userId: result.userId,
			displayName: result.displayName,
			realName: result.realName || "",
			pronouns: result.pronouns,
			imageUrl: result.imageUrl,
			expiration: new Date(result.expiration),
		};

		// Populate LRU cache with eviction
		if (this.userCache.size >= LRU_MAX_SIZE) {
			const firstKey = this.userCache.keys().next().value;
			if (firstKey !== undefined) this.userCache.delete(firstKey);
		}
		this.userCache.set(normalizedId, { data: user, ts: now });

		return user;
	}

	async getEmoji(name: string): Promise<Emoji | null> {
		const normalizedName = name.toLowerCase();
		const now = Date.now();

		// Check in-memory LRU cache
		const cached = this.emojiCache.get(normalizedName);
		if (cached) {
			if (now - cached.ts < LRU_TTL_MS) {
				this.emojiCache.delete(normalizedName);
				this.emojiCache.set(normalizedName, cached);
				return cached.data;
			}
			this.emojiCache.delete(normalizedName);
		}

		const result = await this.db.get<Emoji>(
			`SELECT ${EMOJI_COLUMNS} FROM emojis WHERE name = ? AND expiration > ?`,
			[normalizedName, now],
		);

		if (!result) return null;

		const emoji: Emoji = {
			type: "emoji",
			id: result.id,
			name: result.name,
			alias: result.alias || null,
			imageUrl: result.imageUrl,
			expiration: new Date(result.expiration),
		};

		// Populate LRU cache with eviction
		if (this.emojiCache.size >= LRU_MAX_SIZE) {
			const firstKey = this.emojiCache.keys().next().value;
			if (firstKey !== undefined) this.emojiCache.delete(firstKey);
		}
		this.emojiCache.set(normalizedName, { data: emoji, ts: now });

		return emoji;
	}

	async getAllEmojis(): Promise<Emoji[]> {
		const results = await this.db.all<Emoji>(
			`SELECT ${EMOJI_COLUMNS} FROM emojis WHERE expiration > ?`,
			[Date.now()],
		);

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

	flushAnalytics(): Promise<void> {
		return this.analytics.flushWriteBuffer();
	}

	recordRequest(
		endpoint: string,
		statusCode: number,
		userAgent?: string,
		responseTime?: number,
		referer?: string,
	): void {
		this.analytics.recordRequest(
			endpoint,
			statusCode,
			userAgent,
			responseTime,
			referer,
		);
	}

	async getAnalytics(days: number = 7): Promise<FullAnalyticsData> {
		await this.analytics.flushWriteBuffer();
		return this.analytics.getAnalytics(days, () => this.getUptime());
	}

	async getEssentialStats(days: number = 7): Promise<EssentialStatsData> {
		await this.analytics.flushWriteBuffer();
		return this.analytics.getEssentialStats(days, () => this.getUptime());
	}

	async getChartData(days: number = 7): Promise<ChartData> {
		await this.analytics.flushWriteBuffer();
		return this.analytics.getChartData(days);
	}

	async getTraffic(
		options: { days?: number; startTime?: number; endTime?: number } = {},
	): Promise<
		Array<{ bucket: number; hits: number; avgLatency: number | null }>
	> {
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
	async close() {
		for (const task of this.cronTasks) {
			task.stop();
		}
		this.cronTasks = [];

		if (this.queueIntervalId) {
			clearInterval(this.queueIntervalId);
			this.queueIntervalId = undefined;
		}

		await this.healthMonitor.endUptimeSession();
		await this.analytics.flushWriteBuffer();
		await this.db.close();
	}
}

export { Cache as SlackCache };
