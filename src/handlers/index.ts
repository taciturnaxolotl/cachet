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
		await recordAnalytics(statusCode);
		return Response.json(health, { status: statusCode });
	}

	const isHealthy = await cache.healthCheck();
	if (isHealthy) {
		await recordAnalytics(200);
		return Response.json({
			status: "healthy",
			cache: true,
			uptime: process.uptime(),
		});
	} else {
		await recordAnalytics(503);
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
				await recordAnalytics(404);
				return Response.json({ message: "User not found" }, { status: 404 });
			}

			Sentry.withScope((scope) => {
				scope.setExtra("url", request.url);
				scope.setExtra("user", userId);
				Sentry.captureException(e);
			});

			await recordAnalytics(500);
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

		await recordAnalytics(200);
		return Response.json({
			id: slackUser.id,
			userId: slackUser.id,
			displayName: slackUser.real_name || slackUser.name || "Unknown",
			pronouns: slackUser.profile?.pronouns || "",
			imageUrl:
				slackUser.profile?.image_512 || slackUser.profile?.image_192 || "",
		});
	}

	await recordAnalytics(200);
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
		let slackUser: SlackUser;
		try {
			slackUser = await slackApp.getUserInfo(userId.toUpperCase());
		} catch (e) {
			if (e instanceof Error && e.message === "user_not_found") {
				console.warn(`⚠️ WARN user not found: ${userId}`);

				await recordAnalytics(307);
				return new Response(null, {
					status: 307,
					headers: {
						Location:
							"https://ca.slack-edge.com/T0266FRGM-U0266FRGP-g28a1f281330-512",
					},
				});
			}

			Sentry.withScope((scope) => {
				scope.setExtra("url", request.url);
				scope.setExtra("user", userId);
				Sentry.captureException(e);
			});

			await recordAnalytics(500);
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

		await recordAnalytics(302);
		return new Response(null, {
			status: 302,
			headers: {
				Location:
					slackUser.profile?.image_512 || slackUser.profile?.image_192 || "",
			},
		});
	}

	await recordAnalytics(302);
	return new Response(null, {
		status: 302,
		headers: { Location: user.imageUrl },
	});
};

export const handlePurgeUser: RouteHandlerWithAnalytics = async (
	request,
	recordAnalytics,
) => {
	const authHeader = request.headers.get("authorization") || "";
	if (authHeader !== `Bearer ${process.env.BEARER_TOKEN}`) {
		await recordAnalytics(401);
		return new Response("Unauthorized", { status: 401 });
	}

	const url = new URL(request.url);
	const userId = url.pathname.split("/")[2] || "";
	const result = await cache.purgeUserCache(userId);

	await recordAnalytics(200);
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
	await recordAnalytics(200);
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
		await recordAnalytics(404);
		return Response.json({ message: "Emoji not found" }, { status: 404 });
	}

	await recordAnalytics(200);
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
		await recordAnalytics(404);
		return Response.json({ message: "Emoji not found" }, { status: 404 });
	}

	await recordAnalytics(302);
	return new Response(null, {
		status: 302,
		headers: { Location: emoji.imageUrl },
	});
};

export const handleResetCache: RouteHandlerWithAnalytics = async (
	request,
	recordAnalytics,
) => {
	const authHeader = request.headers.get("authorization") || "";
	if (authHeader !== `Bearer ${process.env.BEARER_TOKEN}`) {
		await recordAnalytics(401);
		return new Response("Unauthorized", { status: 401 });
	}
	const result = await cache.purgeAll();
	await recordAnalytics(200);
	return Response.json(result);
};

export const handleGetEssentialStats: RouteHandlerWithAnalytics = async (
	request,
	recordAnalytics,
) => {
	const url = new URL(request.url);
	const params = new URLSearchParams(url.search);
	const daysParam = params.get("days");
	const days = daysParam ? parseInt(daysParam, 10) : 7;

	const stats = await cache.getEssentialStats(days);
	await recordAnalytics(200);
	return Response.json(stats);
};

export const handleGetChartData: RouteHandlerWithAnalytics = async (
	request,
	recordAnalytics,
) => {
	const url = new URL(request.url);
	const params = new URLSearchParams(url.search);
	const daysParam = params.get("days");
	const days = daysParam ? parseInt(daysParam, 10) : 7;

	const chartData = await cache.getChartData(days);
	await recordAnalytics(200);
	return Response.json(chartData);
};

export const handleGetUserAgents: RouteHandlerWithAnalytics = async (
	_request,
	recordAnalytics,
) => {
	const userAgents = await cache.getUserAgents();
	await recordAnalytics(200);
	return Response.json(userAgents);
};

export const handleGetReferers: RouteHandlerWithAnalytics = async (
	_request,
	recordAnalytics,
) => {
	const referers = await cache.getReferers();
	await recordAnalytics(200);
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
	const daysParam = params.get("days");

	let options: { days?: number; startTime?: number; endTime?: number } = {};

	if (startParam && endParam) {
		options.startTime = parseInt(startParam, 10);
		options.endTime = parseInt(endParam, 10);
	} else {
		options.days = daysParam ? parseInt(daysParam, 10) : 7;
	}

	const traffic = cache.getTraffic(options);
	await recordAnalytics(200);
	return Response.json(traffic);
};

export const handleGetStats: RouteHandlerWithAnalytics = async (
	request,
	recordAnalytics,
) => {
	const url = new URL(request.url);
	const params = new URLSearchParams(url.search);
	const daysParam = params.get("days");
	const days = daysParam ? parseInt(daysParam, 10) : 7;

	const [essentialStats, chartData, userAgents] = await Promise.all([
		cache.getEssentialStats(days),
		cache.getChartData(days),
		cache.getUserAgents(days),
	]);

	await recordAnalytics(200);
	return Response.json({
		...essentialStats,
		chartData,
		userAgents,
	});
};
