/**
 * Analytics data type definitions and cache helper
 */

export interface EndpointMetrics {
	endpoint: string;
	count: number;
	averageResponseTime: number;
}

export interface StatusMetrics {
	status: number;
	count: number;
	averageResponseTime: number;
}

export interface DayMetrics {
	date: string;
	count: number;
	averageResponseTime: number;
}

export interface UserAgentMetrics {
	userAgent: string;
	hits: number;
}

export interface LatencyPercentiles {
	p50: number | null;
	p75: number | null;
	p90: number | null;
	p95: number | null;
	p99: number | null;
}

export interface LatencyDistribution {
	range: string;
	count: number;
	percentage: number;
}

export interface LatencyOverTimeMetrics {
	time: string;
	averageResponseTime: number;
	p95: number | null;
	count: number;
}

export interface LatencyAnalytics {
	percentiles: LatencyPercentiles;
	distribution: Array<LatencyDistribution>;
	slowestEndpoints: Array<EndpointMetrics>;
	latencyOverTime: Array<LatencyOverTimeMetrics>;
}

export interface PerformanceMetrics {
	uptime: number;
	errorRate: number;
	throughput: number;
	apdex: number;
	cacheHitRate: number;
}

export interface PeakTraffic {
	peakHour: string;
	peakRequests: number;
	peakDay: string;
	peakDayRequests: number;
}

export interface DashboardMetrics {
	statsRequests: number;
	totalWithStats: number;
}

export interface TrafficOverview {
	time: string;
	routes: Record<string, number>;
	total: number;
}

export interface FullAnalyticsData {
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

export interface EssentialStatsData {
	totalRequests: number;
	averageResponseTime: number | null;
	uptime: number;
}

export interface ChartData {
	requestsByDay: Array<DayMetrics>;
	latencyOverTime: Array<LatencyOverTimeMetrics>;
}

export type UserAgentData = Array<UserAgentMetrics>;

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
export class AnalyticsCache {
	private cache: Map<string, AnalyticsCacheEntry>;
	private cacheTTL: number;
	private maxCacheSize: number;

	constructor(cacheTTL: number = 30000, maxCacheSize: number = 10) {
		this.cache = new Map();
		this.cacheTTL = cacheTTL;
		this.maxCacheSize = maxCacheSize;
	}

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

	setAnalyticsData(key: string, data: FullAnalyticsData): void {
		this.setCacheEntry(key, { type: "analytics", data });
	}

	setEssentialStatsData(key: string, data: EssentialStatsData): void {
		this.setCacheEntry(key, { type: "essential", data });
	}

	setChartData(key: string, data: ChartData): void {
		this.setCacheEntry(key, { type: "charts", data });
	}

	setUserAgentData(key: string, data: UserAgentData): void {
		this.setCacheEntry(key, { type: "useragents", data });
	}

	private setCacheEntry(key: string, data: AnalyticsCacheData): void {
		this.cache.set(key, {
			data,
			timestamp: Date.now(),
		});

		if (this.cache.size > this.maxCacheSize) {
			const keys = Array.from(this.cache.keys());
			const oldestKey = keys[0];
			if (oldestKey) {
				this.cache.delete(oldestKey);
			}
		}
	}
}
