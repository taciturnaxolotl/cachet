/**
 * Analytics wrapper utility to eliminate boilerplate in route handlers
 */

import type { SlackCache } from "../cache";
import { addCorsHeaders, corsPreflightResponse } from "./cors";
import { fastPathname } from "./fast-url";

export type AnalyticsRecorder = (statusCode: number) => void;
export type RouteHandlerWithAnalytics = (
	request: Request,
	recordAnalytics: AnalyticsRecorder,
) => Promise<Response> | Response;

/**
 * Creates analytics wrapper with injected cache.
 * Pre-computes static values at registration time to minimize per-request work.
 */
export function createAnalyticsWrapper(cache: SlackCache) {
	return function withAnalytics(
		path: string,
		_method: string,
		handler: RouteHandlerWithAnalytics,
	) {
		const isDynamic = path.includes(":");
		const skipAnalytics = path === "/health";

		// For static paths, pre-bind everything so the recorder is near-zero cost
		if (!skipAnalytics && !isDynamic) {
			return async (request: Request): Promise<Response> => {
				if (request.method === "OPTIONS") return corsPreflightResponse();

				const startTime = performance.now();
				const userAgent = request.headers.get("user-agent") || "";
				const referer = request.headers.get("referer") || undefined;

				const recordAnalytics: AnalyticsRecorder = (statusCode) => {
					cache.recordRequest(
						path,
						statusCode,
						userAgent,
						performance.now() - startTime,
						referer,
					);
				};

				const response = await handler(request, recordAnalytics);
				return addCorsHeaders(response);
			};
		}

		// Skip analytics entirely for health checks
		if (skipAnalytics) {
			return async (request: Request): Promise<Response> => {
				if (request.method === "OPTIONS") return corsPreflightResponse();
				const noop: AnalyticsRecorder = () => {};
				const response = await handler(request, noop);
				return addCorsHeaders(response);
			};
		}

		// Dynamic paths: need URL parsing
		return async (request: Request): Promise<Response> => {
			if (request.method === "OPTIONS") return corsPreflightResponse();

			const startTime = performance.now();
			const userAgent = request.headers.get("user-agent") || "";
			const referer = request.headers.get("referer") || undefined;

			const recordAnalytics: AnalyticsRecorder = (statusCode) => {
				cache.recordRequest(
					fastPathname(request.url),
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
