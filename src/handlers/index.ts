/**
 * All route handler functions extracted for reuse
 */

import * as Sentry from "@sentry/bun";
// These will be injected by the route system
import type { SlackCache } from "../cache";
import type { RouteHandlerWithAnalytics } from "../lib/analytics-wrapper";
import type { SlackUser } from "../slack";
import type { SlackWrapper } from "../slackWrapper";

let cache!: SlackCache;
let slackApp!: SlackWrapper;

/**
 * Parse a string to a positive integer, returning a fallback if invalid
 */
function parsePositiveInt(value: string | null, fallback: number): number {
	if (!value) return fallback;
	const n = Number.parseInt(value, 10);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function injectDependencies(
	cacheInstance: SlackCache,
	slackInstance: SlackWrapper,
) {
	cache = cacheInstance;
	slackApp = slackInstance;
}

export const handleHealthCheck: RouteHandlerWithAnalytics = async (
	request,
	recordAnalytics,
) => {
	const url = new URL(request.url);
	const detailed = url.searchParams.get("detailed") === "true";

	if (detailed) {
		const health = await cache.detailedHealthCheck();
		const statusCode =
			health.status === "unhealthy"
				? 503
				: health.status === "degraded"
					? 200
					: 200;
		recordAnalytics(statusCode);
		return Response.json(health, { status: statusCode });
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
		return Response.json(
			{ status: "unhealthy", error: "Cache connection failed" },
			{ status: 503 },
		);
	}
};

export const handleGetUser: RouteHandlerWithAnalytics = async (
	request,
	recordAnalytics,
) => {
	const url = new URL(request.url);
	const userId = url.pathname.split("/").pop() || "";
	const user = await cache.getUser(userId);

	if (!user || !user.imageUrl) {
		let slackUser: SlackUser;
		try {
			slackUser = await slackApp.getUserInfo(userId);
		} catch (e) {
			if (e instanceof Error && e.message === "user_not_found") {
				recordAnalytics(404);
				return Response.json({ message: "User not found" }, { status: 404 });
			}

			Sentry.withScope((scope) => {
				scope.setExtra("url", request.url);
				scope.setExtra("user", userId);
				Sentry.captureException(e);
			});

			recordAnalytics(500);
			return Response.json(
				{ message: "Internal server error" },
				{ status: 500 },
			);
		}

		await cache.insertUser(
			slackUser.id,
			slackUser.real_name || slackUser.name || "Unknown",
			slackUser.profile?.pronouns || "",
			slackUser.profile?.image_512 || slackUser.profile?.image_192 || "",
		);

		recordAnalytics(200);
		return Response.json({
			id: slackUser.id,
			userId: slackUser.id,
			displayName: slackUser.real_name || slackUser.name || "Unknown",
			pronouns: slackUser.profile?.pronouns || "",
			imageUrl:
				slackUser.profile?.image_512 || slackUser.profile?.image_192 || "",
		});
	}

	recordAnalytics(200);
	return Response.json(user);
};

export const handleUserRedirect: RouteHandlerWithAnalytics = async (
	request,
	recordAnalytics,
) => {
	const url = new URL(request.url);
	const parts = url.pathname.split("/");
	const userId = parts[2] || "";
	const user = await cache.getUser(userId);

	if (!user || !user.imageUrl) {
		cache.queueUserUpdate(userId);
		recordAnalytics(307);
		return new Response(null, {
			status: 307,
			headers: {
				Location: "https://l4.dunkirk.sh/i/5DjfoBI58Pfw.webp",
			},
		});
	}

	recordAnalytics(302);
	return new Response(null, {
		status: 302,
		headers: { Location: user.imageUrl },
	});
};

export const handlePurgeUser: RouteHandlerWithAnalytics = async (
	request,
	recordAnalytics,
) => {
	const configuredToken = process.env.BEARER_TOKEN;
	if (!configuredToken) {
		console.error("BEARER_TOKEN is not configured");
		recordAnalytics(500);
		return new Response("Server misconfigured", { status: 500 });
	}

	const authHeader = request.headers.get("authorization") || "";
	if (authHeader !== `Bearer ${configuredToken}`) {
		recordAnalytics(401);
		return new Response("Unauthorized", { status: 401 });
	}

	const url = new URL(request.url);
	const userId = url.pathname.split("/")[2] || "";
	const result = await cache.purgeUserCache(userId);

	recordAnalytics(200);
	return Response.json({
		message: "User cache purged",
		userId,
		success: result,
	});
};

export const handleListEmojis: RouteHandlerWithAnalytics = async (
	_request,
	recordAnalytics,
) => {
	const emojis = await cache.getAllEmojis();
	recordAnalytics(200);
	return Response.json(emojis);
};

export const handleGetEmoji: RouteHandlerWithAnalytics = async (
	request,
	recordAnalytics,
) => {
	const url = new URL(request.url);
	const emojiName = url.pathname.split("/").pop() || "";
	const emoji = await cache.getEmoji(emojiName);

	if (!emoji) {
		recordAnalytics(404);
		return Response.json({ message: "Emoji not found" }, { status: 404 });
	}

	recordAnalytics(200);
	return Response.json(emoji);
};

export const handleEmojiRedirect: RouteHandlerWithAnalytics = async (
	request,
	recordAnalytics,
) => {
	const url = new URL(request.url);
	const parts = url.pathname.split("/");
	const emojiName = parts[2] || "";
	const emoji = await cache.getEmoji(emojiName);

	if (!emoji) {
		recordAnalytics(404);
		return Response.json({ message: "Emoji not found" }, { status: 404 });
	}

	recordAnalytics(302);
	return new Response(null, {
		status: 302,
		headers: { Location: emoji.imageUrl },
	});
};

export const handleResetCache: RouteHandlerWithAnalytics = async (
	request,
	recordAnalytics,
) => {
	const configuredToken = process.env.BEARER_TOKEN;
	if (!configuredToken) {
		console.error("BEARER_TOKEN is not configured");
		recordAnalytics(500);
		return new Response("Server misconfigured", { status: 500 });
	}

	const authHeader = request.headers.get("authorization") || "";
	if (authHeader !== `Bearer ${configuredToken}`) {
		recordAnalytics(401);
		return new Response("Unauthorized", { status: 401 });
	}
	const result = await cache.purgeAll();
	recordAnalytics(200);
	return Response.json(result);
};

export const handleGetEssentialStats: RouteHandlerWithAnalytics = async (
	request,
	recordAnalytics,
) => {
	const url = new URL(request.url);
	const params = new URLSearchParams(url.search);
	const days = parsePositiveInt(params.get("days"), 7);

	const stats = await cache.getEssentialStats(days);
	recordAnalytics(200);
	return Response.json(stats);
};

export const handleGetChartData: RouteHandlerWithAnalytics = async (
	request,
	recordAnalytics,
) => {
	const url = new URL(request.url);
	const params = new URLSearchParams(url.search);
	const days = parsePositiveInt(params.get("days"), 7);

	const chartData = await cache.getChartData(days);
	recordAnalytics(200);
	return Response.json(chartData);
};

export const handleGetUserAgents: RouteHandlerWithAnalytics = async (
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

export const handleGetReferers: RouteHandlerWithAnalytics = async (
	_request,
	recordAnalytics,
) => {
	const referers = await cache.getReferers();
	recordAnalytics(200);
	return Response.json(referers);
};

export const handleGetTraffic: RouteHandlerWithAnalytics = async (
	request,
	recordAnalytics,
) => {
	const url = new URL(request.url);
	const params = new URLSearchParams(url.search);

	const startParam = params.get("start");
	const endParam = params.get("end");

	let options: { days?: number; startTime?: number; endTime?: number } = {};

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
		options.days = parsePositiveInt(params.get("days"), 7);
	}

	const traffic = cache.getTraffic(options);
	recordAnalytics(200);
	return Response.json(traffic);
};

export const handleGetStats: RouteHandlerWithAnalytics = async (
	request,
	recordAnalytics,
) => {
	const url = new URL(request.url);
	const params = new URLSearchParams(url.search);
	const days = parsePositiveInt(params.get("days"), 7);

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
