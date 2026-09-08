import { asNumber } from "../db/dialect";
import type { Db } from "../db/types";
import type { SlackUserProvider } from "../types/cache-entities";

/**
 * Health monitoring and uptime tracking service
 */
export class HealthMonitor {
	private db: Db;
	private currentSessionId?: number;
	private slackWrapper?: SlackUserProvider;
	private queueSizes: () => { newUser: number; refresh: number };

	// Cached Slack API health check result (60 second TTL)
	private slackHealthCache: {
		status: boolean;
		error?: string;
		timestamp: number;
	} | null = null;
	private slackHealthCacheTTL = 60000;

	// Cached detailed health check response (5 second TTL for high-load scenarios)
	private detailedHealthCache: {
		response: DetailedHealthResponse;
		timestamp: number;
	} | null = null;
	private detailedHealthCacheTTL = 5000;

	constructor(db: Db, queueSizes: () => { newUser: number; refresh: number }) {
		this.db = db;
		this.queueSizes = queueSizes;
	}

	setSlackWrapper(slackWrapper: SlackUserProvider) {
		this.slackWrapper = slackWrapper;
	}

	/**
	 * Starts a new uptime session and closes any orphaned sessions from crashes
	 */
	async startUptimeSession() {
		const now = Date.now();

		const orphanedSessions = await this.db.all<{
			id: number;
			start_time: number;
		}>(
			`SELECT ${asNumber("id")} AS id, ${asNumber("start_time")} AS start_time
			 FROM uptime_sessions WHERE end_time IS NULL`,
		);

		for (const session of orphanedSessions) {
			const lastActivity = await this.db.get<{ last_bucket: number | null }>(
				`SELECT ${asNumber("MAX(bucket) * 1000")} as last_bucket FROM traffic_10min`,
			);

			const estimatedEnd =
				lastActivity?.last_bucket &&
				lastActivity.last_bucket > session.start_time
					? lastActivity.last_bucket
					: session.start_time + 60000;

			const duration = estimatedEnd - session.start_time;
			await this.db.run(
				"UPDATE uptime_sessions SET end_time = ?, duration = ? WHERE id = ?",
				[estimatedEnd, duration, session.id],
			);
			console.log(
				`Closed orphaned session ${session.id} (likely crash), estimated duration: ${Math.round(duration / 1000)}s`,
			);
		}

		const result = await this.db.get<{ id: number }>(
			`INSERT INTO uptime_sessions (start_time) VALUES (?) RETURNING ${asNumber("id")} AS id`,
			[now],
		);
		this.currentSessionId = result?.id;
	}

	/**
	 * Ends the current uptime session (call on graceful shutdown)
	 */
	async endUptimeSession() {
		if (!this.currentSessionId) return;
		const now = Date.now();
		const session = await this.db.get<{ start_time: number }>(
			`SELECT ${asNumber("start_time")} AS start_time FROM uptime_sessions WHERE id = ?`,
			[this.currentSessionId],
		);
		if (session) {
			const duration = now - session.start_time;
			await this.db.run(
				"UPDATE uptime_sessions SET end_time = ?, duration = ? WHERE id = ?",
				[now, duration, this.currentSessionId],
			);
		}
	}

	/**
	 * Gets uptime percentage over the last 90 days
	 */
	async getUptime(): Promise<number> {
		const now = Date.now();
		const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
		const windowStart = now - ninetyDaysMs;

		const firstSession = await this.db.get<{ first_start: number | null }>(
			`SELECT ${asNumber("MIN(start_time)")} as first_start FROM uptime_sessions WHERE start_time >= ?`,
			[windowStart],
		);

		if (!firstSession?.first_start) {
			return 100;
		}

		const totalWindow = now - firstSession.first_start;
		if (totalWindow <= 0) return 100;

		const completedResult = await this.db.get<{ total: number }>(
			`SELECT ${asNumber("COALESCE(SUM(duration), 0)")} as total FROM uptime_sessions WHERE duration IS NOT NULL AND start_time >= ?`,
			[windowStart],
		);

		const currentSession = this.currentSessionId
			? await this.db.get<{ start_time: number }>(
					`SELECT ${asNumber("start_time")} AS start_time FROM uptime_sessions WHERE id = ?`,
					[this.currentSessionId],
				)
			: null;

		const currentDuration = currentSession
			? now - Math.max(currentSession.start_time, windowStart)
			: 0;
		const totalUptime = (completedResult?.total ?? 0) + currentDuration;

		return Math.min(100, (totalUptime / totalWindow) * 100);
	}

	/**
	 * Checks if the cache is healthy by testing database connectivity
	 */
	async healthCheck(): Promise<boolean> {
		try {
			await this.db.get("SELECT 1");
			return true;
		} catch (error) {
			console.error("Cache health check failed:", error);
			return false;
		}
	}

	/**
	 * Detailed health check with component status
	 */
	async detailedHealthCheck(): Promise<DetailedHealthResponse> {
		const now = Date.now();
		if (
			this.detailedHealthCache &&
			now - this.detailedHealthCache.timestamp < this.detailedHealthCacheTTL
		) {
			return this.detailedHealthCache.response;
		}
		const queues = this.queueSizes();
		const checks: DetailedHealthResponse["checks"] = {
			database: { status: false, latency: 0 },
			slackApi: { status: false },
			queueDepth: queues.newUser + queues.refresh,
			queueDetail: { newUser: queues.newUser, refresh: queues.refresh },
			memoryUsage: {
				heapUsed: 0,
				heapTotal: 0,
				percentage: 0,
			},
		};

		try {
			const start = Date.now();
			await this.db.get("SELECT 1");
			checks.database = { status: true, latency: Date.now() - start };
		} catch (error) {
			console.error("Database health check failed:", error);
		}

		if (this.slackWrapper) {
			const now = Date.now();
			if (
				this.slackHealthCache &&
				now - this.slackHealthCache.timestamp < this.slackHealthCacheTTL
			) {
				checks.slackApi = {
					status: this.slackHealthCache.status,
					error: this.slackHealthCache.error,
				};
			} else {
				try {
					await this.slackWrapper.testAuth();
					this.slackHealthCache = { status: true, timestamp: now };
					checks.slackApi = { status: true };
				} catch (error) {
					const errorMsg =
						error instanceof Error ? error.message : "Unknown error";
					this.slackHealthCache = {
						status: false,
						error: errorMsg,
						timestamp: now,
					};
					checks.slackApi = {
						status: false,
						error: errorMsg,
					};
				}
			}
		} else {
			checks.slackApi = { status: true };
		}

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

		let status: "healthy" | "degraded" | "unhealthy" = "healthy";
		if (!checks.database.status) {
			status = "unhealthy";
		} else if (!checks.slackApi.status || checks.queueDetail.newUser > 100) {
			status = "degraded";
		} else if (checks.memoryUsage.percentage >= 120) {
			status = "degraded";
		}

		const response: DetailedHealthResponse = {
			status,
			checks,
			uptime: process.uptime(),
		};

		this.detailedHealthCache = {
			response,
			timestamp: Date.now(),
		};

		return response;
	}
}

export interface DetailedHealthResponse {
	status: "healthy" | "degraded" | "unhealthy";
	checks: {
		database: { status: boolean; latency?: number };
		slackApi: { status: boolean; error?: string };
		queueDepth: number;
		queueDetail: { newUser: number; refresh: number };
		memoryUsage: {
			heapUsed: number;
			heapTotal: number;
			percentage: number;
			details?: {
				heapUsedMiB: number;
				heapTotalMiB: number;
				heapPercent: number;
				rssMiB: number;
				externalMiB: number;
				arrayBuffersMiB: number;
			};
		};
	};
	uptime: number;
}
