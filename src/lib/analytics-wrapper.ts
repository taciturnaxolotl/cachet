/**
 * Analytics wrapper utility to eliminate boilerplate in route handlers
 */

import type { SlackCache } from "../cache";

// Cache will be injected by the route system

export type AnalyticsRecorder = (statusCode: number) => void;
export type RouteHandlerWithAnalytics = (
	request: Request,
	recordAnalytics: AnalyticsRecorder,
) => Promise<Response> | Response;

/**
 * Add CORS headers to a response
 */
function addCorsHeaders(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.set("Access-Control-Allow-Origin", "*");
	headers.set(
		"Access-Control-Allow-Methods",
		"GET, POST, PUT, DELETE, OPTIONS",
	);
	headers.set(
		"Access-Control-Allow-Headers",
		"Content-Type, Authorization, X-Requested-With",
	);
	headers.set("Access-Control-Max-Age", "86400");

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

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
			// Handle OPTIONS preflight requests
			if (request.method === "OPTIONS") {
				return new Response(null, {
					status: 204,
					headers: {
						"Access-Control-Allow-Origin": "*",
						"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
						"Access-Control-Allow-Headers":
							"Content-Type, Authorization, X-Requested-With",
						"Access-Control-Max-Age": "86400",
					},
				});
			}

			const startTime = Date.now();

			const recordAnalytics: AnalyticsRecorder = (statusCode: number) => {
				const userAgent = request.headers.get("user-agent") || "";
				const ipAddress =
					request.headers.get("x-forwarded-for") ||
					request.headers.get("x-real-ip") ||
					"unknown";
				const referer = request.headers.get("referer") || undefined;

				// Use the pathname for dynamic paths to ensure proper endpoint grouping
				const requestUrl = new URL(request.url);
				const analyticsPath = path.includes(":") ? requestUrl.pathname : path;

				cache.recordRequest(
					analyticsPath,
					method,
					statusCode,
					userAgent,
					ipAddress,
					Date.now() - startTime,
					referer,
				);
			};

			const response = await handler(request, recordAnalytics);
			return addCorsHeaders(response);
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
