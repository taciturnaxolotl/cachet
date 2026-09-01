/**
 * All route handler functions extracted for reuse
 */

import { getEmojiUrl } from "../../utils/emojiHelper";
import type { SlackCache } from "../cache";
import { config } from "../config";
import type { RouteHandlerWithAnalytics } from "../lib/analytics-wrapper";
import { lastSegment, pathSegment, queryParam } from "../lib/fast-url";
import { jsonError } from "../lib/http-errors";

/**
 * Parse a string to a positive integer, returning a fallback if invalid
 */
export function parsePositiveInt(
	value: string | null,
	fallback: number,
): number {
	if (!value) return fallback;
	const n = Number.parseInt(value, 10);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Analytics results are cached per day count, so bound it to keep the cache from thrashing */
const MAX_DAYS = 365;

function parseDays(url: string): number {
	return Math.min(parsePositiveInt(queryParam(url, "days"), 7), MAX_DAYS);
}

/**
 * Creates all handlers with dependencies bound via closure.
 * Eliminates global mutable state and injectDependencies pattern.
 */
export function createHandlers(cache: SlackCache) {
	function requireAuth(
		request: Request,
		recordAnalytics: (code: number) => void,
	): Response | null {
		const token = config.bearerToken;
		if (!token) {
			console.error("BEARER_TOKEN is not configured");
			recordAnalytics(500);
			return jsonError(
				500,
				"AUTH_NOT_CONFIGURED",
				"Administrative authentication is not configured.",
				"Ask the service operator to configure BEARER_TOKEN.",
			);
		}
		const authHeader = request.headers.get("authorization") || "";
		if (authHeader !== `Bearer ${token}`) {
			recordAnalytics(401);
			return jsonError(
				401,
				"UNAUTHORIZED",
				"A valid bearer token is required for this endpoint.",
				"Send the service's token in the Authorization: Bearer <token> header.",
			);
		}
		return null;
	}

	const handleHealthCheck: RouteHandlerWithAnalytics = async (
		request,
		recordAnalytics,
	) => {
		const detailed = queryParam(request.url, "detailed") === "true";

		if (detailed) {
			const health = await cache.detailedHealthCheck();
			const statusCode =
				health.status === "unhealthy"
					? 503
					: health.status === "degraded"
						? 200
						: 200;
			recordAnalytics(statusCode);
			if (statusCode === 503) {
				return jsonError(
					503,
					"SERVICE_UNHEALTHY",
					"One or more required service checks failed.",
					"Inspect the checks object, resolve failed dependencies, and retry.",
					{ extra: health },
				);
			}
			return Response.json(health);
		}

		const isHealthy = await cache.healthCheck();
		if (isHealthy) {
			recordAnalytics(200);
			return Response.json({
				status: "healthy",
				cache: true,
				uptime: process.uptime(),
			});
		} else {
			recordAnalytics(503);
			return jsonError(
				503,
				"CACHE_UNAVAILABLE",
				"The cache database is unavailable.",
				"Retry later or inspect /health?detailed=true for diagnostic checks.",
				{ extra: { status: "unhealthy", cache: false } },
			);
		}
	};

	const handleGetUser: RouteHandlerWithAnalytics = async (
		request,
		recordAnalytics,
	) => {
		const userId = lastSegment(request.url);
		const user = await cache.getUser(userId);

		if (!user?.imageUrl) {
			cache.queueUserUpdate(userId);
			recordAnalytics(202);
			return Response.json(
				{
					id: userId.toUpperCase(),
					userId: userId.toUpperCase(),
					displayName: "Unknown",
					realName: "",
					pronouns: "",
					imageUrl: "https://l4-bucket.dunkirk.sh/5DjfoBI58Pfw.webp",
				},
				{ status: 202 },
			);
		}

		recordAnalytics(200);
		return Response.json(user);
	};

	const handleUserRedirect: RouteHandlerWithAnalytics = async (
		request,
		recordAnalytics,
	) => {
		const userId = pathSegment(request.url, 1);
		const user = await cache.getUser(userId);

		if (!user?.imageUrl) {
			cache.queueUserUpdate(userId);
			recordAnalytics(307);
			return new Response(null, {
				status: 307,
				headers: {
					Location: "https://l4-bucket.dunkirk.sh/5DjfoBI58Pfw.webp",
				},
			});
		}

		recordAnalytics(302);
		return new Response(null, {
			status: 302,
			headers: { Location: user.imageUrl },
		});
	};

	const handlePurgeUser: RouteHandlerWithAnalytics = async (
		request,
		recordAnalytics,
	) => {
		const authError = requireAuth(request, recordAnalytics);
		if (authError) return authError;

		const userId = pathSegment(request.url, 1);
		const result = await cache.purgeUserCache(userId);

		recordAnalytics(200);
		return Response.json({
			message: "User cache purged",
			userId,
			success: result,
		});
	};

	const handleListEmojis: RouteHandlerWithAnalytics = async (
		_request,
		recordAnalytics,
	) => {
		const emojis = await cache.getAllEmojis();
		recordAnalytics(200);
		return Response.json(emojis);
	};

	const handlePurgeEmojis: RouteHandlerWithAnalytics = async (
		request,
		recordAnalytics,
	) => {
		const authError = requireAuth(request, recordAnalytics);
		if (authError) return authError;

		const count = await cache.purgeEmojis();

		recordAnalytics(200);
		return Response.json({
			message: "Emojis purged",
			emojis: count,
		});
	};

	const handleGetEmoji: RouteHandlerWithAnalytics = async (
		request,
		recordAnalytics,
	) => {
		const emojiName = lastSegment(request.url);
		const emoji = await cache.getEmoji(emojiName);

		if (!emoji) {
			const nativeEmojiUrl = getEmojiUrl(emojiName);
			if (!nativeEmojiUrl) {
				recordAnalytics(404);
				return jsonError(
					404,
					"EMOJI_NOT_FOUND",
					`No cached or native emoji named "${emojiName}" was found.`,
					"Check the name with GET /emojis and retry without surrounding colons.",
				);
			}

			recordAnalytics(200);
			return Response.json({
				type: "emoji",
				id: `native:${emojiName.toLowerCase()}`,
				name: emojiName.toLowerCase(),
				alias: null,
				imageUrl: nativeEmojiUrl,
				expiration: null,
			});
		}

		recordAnalytics(200);
		return Response.json(emoji);
	};

	const handleEmojiRedirect: RouteHandlerWithAnalytics = async (
		request,
		recordAnalytics,
	) => {
		const emojiName = pathSegment(request.url, 1);
		const emoji = await cache.getEmoji(emojiName);

		if (!emoji) {
			const nativeEmojiUrl = getEmojiUrl(emojiName);
			if (!nativeEmojiUrl) {
				recordAnalytics(404);
				return jsonError(
					404,
					"EMOJI_NOT_FOUND",
					`No cached or native emoji named "${emojiName}" was found.`,
					"Check the name with GET /emojis and retry without surrounding colons.",
				);
			}

			recordAnalytics(302);
			return new Response(null, {
				status: 302,
				headers: { Location: nativeEmojiUrl },
			});
		}

		recordAnalytics(302);
		return new Response(null, {
			status: 302,
			headers: { Location: emoji.imageUrl },
		});
	};

	const handleResetCache: RouteHandlerWithAnalytics = async (
		request,
		recordAnalytics,
	) => {
		const authError = requireAuth(request, recordAnalytics);
		if (authError) return authError;

		const result = await cache.purgeAll();
		recordAnalytics(200);
		return Response.json(result);
	};

	const handleGetEssentialStats: RouteHandlerWithAnalytics = async (
		request,
		recordAnalytics,
	) => {
		const days = parseDays(request.url);

		const stats = await cache.getEssentialStats(days);
		recordAnalytics(200);
		return Response.json(stats);
	};

	const handleGetChartData: RouteHandlerWithAnalytics = async (
		request,
		recordAnalytics,
	) => {
		const days = parseDays(request.url);

		const chartData = await cache.getChartData(days);
		recordAnalytics(200);
		return Response.json(chartData);
	};

	const handleGetUserAgents: RouteHandlerWithAnalytics = async (
		_request,
		recordAnalytics,
	) => {
		const [userAgents, totalCount] = await Promise.all([
			cache.getUserAgents(),
			cache.getUserAgentCount(),
		]);
		recordAnalytics(200);
		return Response.json({ userAgents, totalCount });
	};

	const handleGetReferers: RouteHandlerWithAnalytics = async (
		_request,
		recordAnalytics,
	) => {
		const referers = await cache.getReferers();
		recordAnalytics(200);
		return Response.json(referers);
	};

	const handleGetTraffic: RouteHandlerWithAnalytics = async (
		request,
		recordAnalytics,
	) => {
		const startParam = queryParam(request.url, "start");
		const endParam = queryParam(request.url, "end");

		const options: { days?: number; startTime?: number; endTime?: number } = {};

		if (startParam && endParam) {
			const start = parsePositiveInt(startParam, 0);
			const end = parsePositiveInt(endParam, 0);
			if (start > 0 && end > 0) {
				options.startTime = start;
				options.endTime = end;
			} else {
				options.days = 7;
			}
		} else {
			options.days = parseDays(request.url);
		}

		const traffic = cache.getTraffic(options);
		recordAnalytics(200);
		return Response.json(traffic);
	};

	const handleGetStats: RouteHandlerWithAnalytics = async (
		request,
		recordAnalytics,
	) => {
		const days = parseDays(request.url);

		const [essentialStats, chartData, userAgents] = await Promise.all([
			cache.getEssentialStats(days),
			cache.getChartData(days),
			cache.getUserAgents(),
		]);

		recordAnalytics(200);
		return Response.json({
			...essentialStats,
			chartData,
			userAgents,
		});
	};

	return {
		handleHealthCheck,
		handleGetUser,
		handleUserRedirect,
		handlePurgeUser,
		handleListEmojis,
		handleGetEmoji,
		handleEmojiRedirect,
		handlePurgeEmojis,
		handleResetCache,
		handleGetEssentialStats,
		handleGetChartData,
		handleGetUserAgents,
		handleGetReferers,
		handleGetTraffic,
		handleGetStats,
	};
}
