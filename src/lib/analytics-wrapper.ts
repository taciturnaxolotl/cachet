/**
 * Analytics wrapper utility to eliminate boilerplate in route handlers
 */

import type { SlackCache } from "../cache";

// Cache will be injected by the route system

export type AnalyticsRecorder = (statusCode: number) => Promise<void>;
export type RouteHandlerWithAnalytics = (
	request: Request,
	recordAnalytics: AnalyticsRecorder,
) => Promise<Response> | Response;

/**
 * Creates analytics wrapper with injected cache
 */
export function createAnalyticsWrapper(cache: SlackCache) {
	return function withAnalytics(
		path: string,
		method: string,
		handler: RouteHandlerWithAnalytics,
	) {
		return async (request: Request): Promise<Response> => {
			const startTime = Date.now();

			const recordAnalytics: AnalyticsRecorder = async (statusCode: number) => {
				const userAgent = request.headers.get("user-agent") || "";
				const ipAddress =
					request.headers.get("x-forwarded-for") ||
					request.headers.get("x-real-ip") ||
					"unknown";

				// Use the actual request URL for dynamic paths, fallback to provided path
				const analyticsPath = path.includes(":") ? request.url : path;

				await cache.recordRequest(
					analyticsPath,
					method,
					statusCode,
					userAgent,
					ipAddress,
					Date.now() - startTime,
				);
			};

			return handler(request, recordAnalytics);
		};
	};
}

/**
 * Type-safe analytics wrapper that automatically infers path and method
 */
export function createAnalyticsHandler(
	cache: SlackCache,
	path: string,
	method: string,
) {
	return (handler: RouteHandlerWithAnalytics) =>
		createAnalyticsWrapper(cache)(path, method, handler);
}
