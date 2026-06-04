/**
 * Analytics wrapper utility to eliminate boilerplate in route handlers
 */

import type { SlackCache } from "../cache";
import { addCorsHeaders, corsPreflightResponse } from "./cors";

// Cache will be injected by the route system

export type AnalyticsRecorder = (statusCode: number) => void;
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
			if (request.method === "OPTIONS") {
				return corsPreflightResponse();
			}

			const startTime = performance.now();

			const recordAnalytics: AnalyticsRecorder = (statusCode: number) => {
				// Skip analytics entirely for health checks to reduce database load
				if (path === "/health") {
					return;
				}

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
					statusCode,
					userAgent,
					Number((performance.now() - startTime).toFixed(3)),
					referer,
				);
			};

			const response = await handler(request, recordAnalytics);
			return addCorsHeaders(response);
		};
	};
}

