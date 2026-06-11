/**
 * Analytics wrapper utility to eliminate boilerplate in route handlers
 */

import type { SlackCache } from "../cache";
import { addCorsHeaders, corsPreflightResponse } from "./cors";

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
		_method: string,
		handler: RouteHandlerWithAnalytics,
	) {
		// Pre-compute whether this path is dynamic to avoid new URL() on every request
		const isDynamic = path.includes(":");

		return async (request: Request): Promise<Response> => {
			if (request.method === "OPTIONS") {
				return corsPreflightResponse();
			}

			const startTime = performance.now();

			const recordAnalytics: AnalyticsRecorder = (statusCode: number) => {
				if (path === "/health") {
					return;
				}

				const userAgent = request.headers.get("user-agent") || "";
				const referer = request.headers.get("referer") || undefined;

				const analyticsPath = isDynamic
					? new URL(request.url).pathname
					: path;

				cache.recordRequest(
					analyticsPath,
					statusCode,
					userAgent,
					performance.now() - startTime,
					referer,
				);
			};

			const response = await handler(request, recordAnalytics);
			return addCorsHeaders(response);
		};
	};
}
