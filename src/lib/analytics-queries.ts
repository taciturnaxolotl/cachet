import type { Database, Statement } from "bun:sqlite";
import { AnalyticsCache } from "../types/analytics";
import type {
	FullAnalyticsData,
	EssentialStatsData,
	ChartData,
	UserAgentData,
} from "../types/analytics";

const SECONDS_PER_10MIN = 600;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;

/**
 * Selects the appropriate bucket table based on time range
 */
export function selectBucketTable(days: number): {
	table: string;
	bucketSize: number;
} {
	if (days <= 1) {
		return { table: "traffic_10min", bucketSize: SECONDS_PER_10MIN };
	} else if (days <= 30) {
		return { table: "traffic_hourly", bucketSize: SECONDS_PER_HOUR };
	} else {
		return { table: "traffic_daily", bucketSize: SECONDS_PER_DAY };
	}
}

/**
 * Groups endpoint names for display
 */
export function groupEndpoint(endpoint: string): string {
	if (endpoint === "/" || endpoint === "/dashboard") {
		return "Dashboard";
	} else if (endpoint === "/health") {
		return "Health Check";
	} else if (endpoint === "/swagger" || endpoint.startsWith("/swagger")) {
		return "API Documentation";
	} else if (endpoint === "/emojis") {
		return "Emoji List";
	} else if (
		endpoint.match(/^\/emojis\/[^/]+$/) ||
		endpoint === "/emojis/EMOJI_NAME"
	) {
		return "Emoji Data";
	} else if (
		endpoint.match(/^\/emojis\/[^/]+\/r$/) ||
		endpoint === "/emojis/EMOJI_NAME/r"
	) {
		return "Emoji Redirects";
	} else if (
		endpoint.match(/^\/users\/[^/]+$/) ||
		endpoint === "/users/USER_ID"
	) {
		return "User Data";
	} else if (
		endpoint.match(/^\/users\/[^/]+\/r$/) ||
		endpoint === "/users/USER_ID/r"
	) {
		return "User Redirects";
	} else if (
		endpoint.match(/^\/users\/[^/]+\/purge$/) ||
		endpoint === "/reset"
	) {
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
 * Analytics query service - handles all analytics read/write operations
 */
export class AnalyticsQueryService {
	private db: Database;
	private typedAnalyticsCache: AnalyticsCache;

	// Prepared statements for hot paths
	private stmtTraffic10min!: Statement;
	private stmtTrafficHourly!: Statement;
	private stmtTrafficDaily!: Statement;
	private stmtUserAgent!: Statement;
	private stmtReferer!: Statement;

	// Write buffer for batched analytics recording
	private writeBuffer: Array<{
		bucket10min: number;
		bucketHour: number;
		bucketDay: number;
		endpoint: string;
		statusCode: number;
		respTime: number;
		userAgent: string | null;
		refererHost: string | null;
		nowMs: number;
	}> = [];
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly FLUSH_INTERVAL_MS = 50;
	private readonly MAX_BUFFER_SIZE = 200;

	constructor(db: Database) {
		this.db = db;
		this.typedAnalyticsCache = new AnalyticsCache();
		this.initPreparedStatements();
	}

	private initPreparedStatements() {
		this.stmtTraffic10min = this.db.prepare(`
			INSERT INTO traffic_10min (bucket, endpoint, status_code, hits, total_response_time)
			VALUES (?1, ?2, ?3, 1, ?4)
			ON CONFLICT(bucket, endpoint, status_code) DO UPDATE SET 
				hits = hits + 1,
				total_response_time = total_response_time + ?4
		`);

		this.stmtTrafficHourly = this.db.prepare(`
			INSERT INTO traffic_hourly (bucket, endpoint, status_code, hits, total_response_time)
			VALUES (?1, ?2, ?3, 1, ?4)
			ON CONFLICT(bucket, endpoint, status_code) DO UPDATE SET 
				hits = hits + 1,
				total_response_time = total_response_time + ?4
		`);

		this.stmtTrafficDaily = this.db.prepare(`
			INSERT INTO traffic_daily (bucket, endpoint, status_code, hits, total_response_time)
			VALUES (?1, ?2, ?3, 1, ?4)
			ON CONFLICT(bucket, endpoint, status_code) DO UPDATE SET 
				hits = hits + 1,
				total_response_time = total_response_time + ?4
		`);

		this.stmtUserAgent = this.db.prepare(`
			INSERT INTO user_agent_stats (user_agent, hits, last_seen)
			VALUES (?1, 1, ?2)
			ON CONFLICT(user_agent) DO UPDATE SET 
				hits = hits + 1,
				last_seen = MAX(last_seen, ?2)
		`);

		this.stmtReferer = this.db.prepare(`
			INSERT INTO referer_stats (referer_host, hits, last_seen)
			VALUES (?1, 1, ?2)
			ON CONFLICT(referer_host) DO UPDATE SET 
				hits = hits + 1,
				last_seen = MAX(last_seen, ?2)
		`);
	}

	/**
	 * Records a request by buffering it for batched writing.
	 * Entries are flushed every 50ms or when the buffer reaches MAX_BUFFER_SIZE.
	 */
	recordRequest(
		endpoint: string,
		statusCode: number,
		userAgent?: string,
		responseTime?: number,
		referer?: string,
	): void {
		const now = Math.floor(Date.now() / 1000);
		const bucket10min = now - (now % SECONDS_PER_10MIN);
		const bucketHour = now - (now % SECONDS_PER_HOUR);
		const bucketDay = now - (now % SECONDS_PER_DAY);
		const respTime = responseTime || 0;
		const nowMs = Date.now();

		let refererHost: string | null = null;
		if (referer) {
			// Fast host extraction: skip "https://" then take until next "/"
			const i = referer.indexOf("://");
			if (i !== -1) {
				const start = i + 3;
				const end = referer.indexOf("/", start);
				refererHost = end === -1 ? referer.substring(start) : referer.substring(start, end);
			}
		}

		this.writeBuffer.push({
			bucket10min,
			bucketHour,
			bucketDay,
			endpoint,
			statusCode,
			respTime,
			userAgent: userAgent || null,
			refererHost,
			nowMs,
		});

		if (this.writeBuffer.length >= this.MAX_BUFFER_SIZE) {
			// Defer flush so it doesn't block the current request's response
			if (!this.flushTimer) {
				this.flushTimer = setTimeout(() => {
					this.flushWriteBuffer();
				}, 0);
			}
		} else if (!this.flushTimer) {
			this.flushTimer = setTimeout(() => {
				this.flushWriteBuffer();
			}, this.FLUSH_INTERVAL_MS);
		}
	}

	/**
	 * Flushes the write buffer in a single transaction
	 */
	flushWriteBuffer(): void {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}

		if (this.writeBuffer.length === 0) return;

		const batch = this.writeBuffer;
		this.writeBuffer = [];

		try {
			this.db.transaction(() => {
				for (const entry of batch) {
					this.stmtTraffic10min.run(
						entry.bucket10min,
						entry.endpoint,
						entry.statusCode,
						entry.respTime,
					);
					this.stmtTrafficHourly.run(
						entry.bucketHour,
						entry.endpoint,
						entry.statusCode,
						entry.respTime,
					);
					this.stmtTrafficDaily.run(
						entry.bucketDay,
						entry.endpoint,
						entry.statusCode,
						entry.respTime,
					);

					if (entry.userAgent) {
						this.stmtUserAgent.run(entry.userAgent, entry.nowMs);
					}

					if (entry.refererHost) {
						this.stmtReferer.run(entry.refererHost, entry.nowMs);
					}
				}
			})();
		} catch (error) {
			console.error("Error flushing analytics write buffer:", error);
		}
	}

	/**
	 * Gets request analytics statistics using bucketed time-series data
	 */
	async getAnalytics(
		days: number = 7,
		getUptime: () => number,
	): Promise<FullAnalyticsData> {
		const cacheKey = `analytics_${days}`;
		const cached = this.typedAnalyticsCache.getAnalyticsData(cacheKey);
		if (cached) {
			return cached;
		}

		const { table, bucketSize } = selectBucketTable(days);
		const cutoffBucket = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
		const alignedCutoff = cutoffBucket - (cutoffBucket % bucketSize);

		const totalResult = this.db
			.query(
				`SELECT SUM(hits) as count FROM ${table} WHERE bucket >= ? AND endpoint != '/stats'`,
			)
			.get(alignedCutoff) as { count: number | null };

		const statsResult = this.db
			.query(
				`SELECT SUM(hits) as count FROM ${table} WHERE bucket >= ? AND endpoint = '/stats'`,
			)
			.get(alignedCutoff) as { count: number | null };

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

		const endpointGroups: Record<
			string,
			{ count: number; totalResponseTime: number; requestCount: number }
		> = {};

		for (const result of rawEndpointResults) {
			const groupKey = groupEndpoint(result.endpoint);

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

		const avgResponseResult = this.db
			.query(
				`
         SELECT SUM(total_response_time) as totalTime, SUM(hits) as totalHits
         FROM ${table}
         WHERE bucket >= ? AND endpoint != '/stats'
       `,
			)
			.get(alignedCutoff) as {
			totalTime: number | null;
			totalHits: number | null;
		};

		const averageResponseTime =
			avgResponseResult.totalHits && avgResponseResult.totalHits > 0
				? (avgResponseResult.totalTime ?? 0) / avgResponseResult.totalHits
				: null;

		const topUserAgents = this.db
			.query(
				`
         SELECT user_agent as userAgent, hits
         FROM user_agent_stats
         WHERE user_agent IS NOT NULL
         ORDER BY hits DESC
         LIMIT 50
       `,
			)
			.all() as Array<{ userAgent: string; hits: number }>;

		const percentiles = {
			p50: null as number | null,
			p75: null as number | null,
			p90: null as number | null,
			p95: null as number | null,
			p99: null as number | null,
		};

		const distribution: Array<{
			range: string;
			count: number;
			percentage: number;
		}> = [];

		const slowestEndpoints = requestsByEndpoint
			.filter((e) => e.averageResponseTime > 0)
			.sort((a, b) => b.averageResponseTime - a.averageResponseTime)
			.slice(0, 10);

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

		const totalCount = totalResult.count ?? 0;
		const errorRequests = statusResults
			.filter((s) => s.status >= 400)
			.reduce((sum, s) => sum + s.count, 0);
		const errorRate = totalCount > 0 ? (errorRequests / totalCount) * 100 : 0;

		const timeSpanHours = days * 24;
		const throughput = totalCount / timeSpanHours;

		const apdex = 0;

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

		const uptime = getUptime();

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

		const timeGroups: Record<string, Record<string, number>> = {};
		for (const row of trafficRaw) {
			if (!timeGroups[row.time]) {
				timeGroups[row.time] = {};
			}

			const groupKey = groupEndpoint(row.endpoint);
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

		const result: FullAnalyticsData = {
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
				statsRequests: statsResult.count ?? 0,
				totalWithStats: totalCount + (statsResult.count ?? 0),
			},
			trafficOverview,
		};

		this.typedAnalyticsCache.setAnalyticsData(cacheKey, result);

		return result;
	}

	/**
	 * Gets essential stats only (fast loading)
	 */
	async getEssentialStats(
		days: number = 7,
		getUptime: () => number,
	): Promise<EssentialStatsData> {
		const cacheKey = `essential_${days}`;
		const cached = this.typedAnalyticsCache.getEssentialStatsData(cacheKey);

		if (cached) {
			return cached;
		}

		const { table, bucketSize } = selectBucketTable(days);
		const cutoffBucket = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
		const alignedCutoff = cutoffBucket - (cutoffBucket % bucketSize);

		const totalResult = this.db
			.query(
				`SELECT SUM(hits) as count FROM ${table} WHERE bucket >= ? AND endpoint != '/stats'`,
			)
			.get(alignedCutoff) as { count: number | null };

		const avgResponseResult = this.db
			.query(
				`SELECT SUM(total_response_time) as totalTime, SUM(hits) as totalHits FROM ${table} WHERE bucket >= ? AND endpoint != '/stats' AND total_response_time > 0`,
			)
			.get(alignedCutoff) as {
			totalTime: number | null;
			totalHits: number | null;
		};

		// Error rate from bucket table (query kept for potential future use)
		this.db
			.query(
				`SELECT SUM(hits) as count FROM ${table} WHERE bucket >= ? AND status_code >= 400 AND endpoint != '/stats'`,
			)
			.get(alignedCutoff);

		const totalCount = totalResult.count ?? 0;
		const result: EssentialStatsData = {
			totalRequests: totalCount,
			averageResponseTime:
				avgResponseResult.totalHits && avgResponseResult.totalHits > 0
					? (avgResponseResult.totalTime ?? 0) / avgResponseResult.totalHits
					: null,
			uptime: getUptime(),
		};

		this.typedAnalyticsCache.setEssentialStatsData(cacheKey, result);

		return result;
	}

	/**
	 * Gets chart data only (requests and latency over time)
	 */
	async getChartData(days: number = 7): Promise<ChartData> {
		const cacheKey = `charts_${days}`;
		const cached = this.typedAnalyticsCache.getChartData(cacheKey);

		if (cached) {
			return cached;
		}

		const { table, bucketSize } = selectBucketTable(days);
		const cutoffBucket = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
		const alignedCutoff = cutoffBucket - (cutoffBucket % bucketSize);

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

		const latencyOverTime = timeResultsRaw.map((r) => ({
			time: r.date,
			averageResponseTime: r.totalHits > 0 ? r.totalTime / r.totalHits : 0,
			p95: null as number | null,
			count: r.count,
		}));

		const result: ChartData = {
			requestsByDay,
			latencyOverTime,
		};

		this.typedAnalyticsCache.setChartData(cacheKey, result);

		return result;
	}

	/**
	 * Gets traffic data for charts with adaptive granularity
	 */
	getTraffic(
		options: { days?: number; startTime?: number; endTime?: number } = {},
	): Array<{ bucket: number; hits: number; avgLatency: number | null }> {
		const now = Math.floor(Date.now() / 1000);
		let start: number;
		let end: number;

		if (options.startTime && options.endTime) {
			start = options.startTime;
			end = options.endTime;
		} else {
			const days = options.days || 7;
			start = now - days * 24 * 60 * 60;
			end = now;
		}

		const spanDays = (end - start) / 86400;
		const { table, bucketSize } = selectBucketTable(spanDays);
		const alignedStart = start - (start % bucketSize);

		const results = this.db
			.query(
				`
				SELECT 
					bucket, 
					SUM(hits) as hits,
					SUM(CASE WHEN total_response_time > 0 THEN total_response_time ELSE 0 END) as totalTime,
					SUM(CASE WHEN total_response_time > 0 THEN hits ELSE 0 END) as hitsWithTime
				FROM ${table}
				WHERE bucket >= ? AND bucket <= ? AND endpoint != '/stats'
				GROUP BY bucket
				ORDER BY bucket ASC
			`,
			)
			.all(alignedStart, end) as Array<{
			bucket: number;
			hits: number;
			totalTime: number;
			hitsWithTime: number;
		}>;

		return results.map((r) => ({
			bucket: r.bucket,
			hits: r.hits,
			avgLatency: r.hitsWithTime > 0 ? r.totalTime / r.hitsWithTime : null,
		}));
	}

	/**
	 * Gets user agents data from cumulative stats table
	 */
	async getUserAgents(): Promise<UserAgentData> {
		const cacheKey = "useragents_all";
		const cached = this.typedAnalyticsCache.getUserAgentData(cacheKey);

		if (cached) {
			return cached;
		}

		const topUserAgents = this.db
			.query(
				`
         SELECT user_agent as userAgent, hits
         FROM user_agent_stats
         WHERE user_agent IS NOT NULL
         ORDER BY hits DESC
         LIMIT 50
       `,
			)
			.all() as Array<{ userAgent: string; hits: number }>;

		this.typedAnalyticsCache.setUserAgentData(cacheKey, topUserAgents);

		return topUserAgents;
	}

	/**
	 * Gets total count of unique user agents
	 */
	async getUserAgentCount(): Promise<number> {
		const result = this.db
			.query(
				`SELECT COUNT(*) as count FROM user_agent_stats WHERE user_agent IS NOT NULL`,
			)
			.get() as { count: number };
		return result?.count || 0;
	}

	/**
	 * Gets referer stats from cumulative stats table
	 */
	async getReferers(): Promise<Array<{ refererHost: string; hits: number }>> {
		const results = this.db
			.query(
				`
				SELECT referer_host as refererHost, hits
				FROM referer_stats
				WHERE referer_host IS NOT NULL
				ORDER BY hits DESC
				LIMIT 50
				`,
			)
			.all() as Array<{ refererHost: string; hits: number }>;

		return results;
	}
}
