/**
 * Complete typed route definitions for all Cachet API endpoints
 */

import type { SlackCache } from "../cache";
import * as handlers from "../handlers";
import { createAnalyticsWrapper } from "../lib/analytics-wrapper";
import type { SlackWrapper } from "../slackWrapper";
import {
	apiResponse,
	createRoute,
	pathParam,
	queryParam,
} from "../types/routes";

// Factory function to create all routes with injected dependencies
export function createApiRoutes(cache: SlackCache, slackApp: SlackWrapper) {
	// Inject dependencies into handlers
	handlers.injectDependencies(cache, slackApp);

	const withAnalytics = createAnalyticsWrapper(cache);

	return {
		"/health": {
			GET: createRoute(
				withAnalytics("/health", "GET", handlers.handleHealthCheck),
				{
					summary: "Health check",
					description:
						"Check if the service is healthy and operational. Add ?detailed=true for comprehensive health information including Slack API status, queue depth, and memory usage.",
					tags: ["Health"],
					parameters: {
						query: [
							queryParam(
								"detailed",
								"boolean",
								"Return detailed health check information",
								false,
								false,
							),
						],
					},
					responses: Object.fromEntries([
						apiResponse(200, "Service is healthy", {
							type: "object",
							properties: {
								status: {
									type: "string",
									example: "healthy",
									enum: ["healthy", "degraded", "unhealthy"],
								},
								cache: { type: "boolean", example: true },
								uptime: { type: "number", example: 123456 },
								checks: {
									type: "object",
									description: "Detailed checks (only with ?detailed=true)",
									properties: {
										database: {
											type: "object",
											properties: {
												status: { type: "boolean" },
												latency: { type: "number", description: "ms" },
											},
										},
										slackApi: {
											type: "object",
											properties: {
												status: { type: "boolean" },
												error: { type: "string" },
											},
										},
										queueDepth: {
											type: "number",
											description: "Number of users queued for update",
										},
										memoryUsage: {
											type: "object",
											properties: {
												heapUsed: { type: "number", description: "MB" },
												heapTotal: { type: "number", description: "MB" },
												percentage: { type: "number" },
												details: {
													type: "object",
													properties: {
														heapUsedMiB: {
															type: "number",
															description: "Precise heap used in MiB",
														},
														heapTotalMiB: {
															type: "number",
															description: "Precise heap total in MiB",
														},
														heapPercent: {
															type: "number",
															description: "Precise heap percentage",
														},
														rssMiB: {
															type: "number",
															description: "Resident Set Size in MiB",
														},
														externalMiB: {
															type: "number",
															description: "External memory in MiB",
														},
														arrayBuffersMiB: {
															type: "number",
															description: "Array buffers in MiB",
														},
													},
												},
											},
										},
									},
								},
							},
						}),
						apiResponse(503, "Service is unhealthy"),
					]),
				},
			),
		},

		"/users/:id": {
			GET: createRoute(
				withAnalytics("/users/:id", "GET", handlers.handleGetUser),
				{
					summary: "Get user information",
					description: "Retrieve cached user profile information from Slack",
					tags: ["Users"],
					parameters: {
						path: [pathParam("id", "string", "Slack user ID", "U062UG485EE")],
					},
					responses: Object.fromEntries([
						apiResponse(200, "User information retrieved successfully", {
							type: "object",
							properties: {
								id: { type: "string", example: "U062UG485EE" },
								userId: { type: "string", example: "U062UG485EE" },
								displayName: { type: "string", example: "Kieran Klukas" },
								pronouns: { type: "string", example: "he/him" },
								imageUrl: {
									type: "string",
									example: "https://avatars.slack-edge.com/...",
								},
							},
						}),
						apiResponse(404, "User not found"),
					]),
				},
			),
		},

		"/users/:id/r": {
			GET: createRoute(
				withAnalytics("/users/:id/r", "GET", handlers.handleUserRedirect),
				{
					summary: "Redirect to user profile image",
					description: "Direct redirect to the user's cached profile image URL",
					tags: ["Users"],
					parameters: {
						path: [pathParam("id", "string", "Slack user ID", "U062UG485EE")],
					},
					responses: Object.fromEntries([
						apiResponse(302, "Redirect to user image"),
						apiResponse(307, "Temporary redirect to default avatar"),
						apiResponse(404, "User not found"),
					]),
				},
			),
		},

		"/users/:id/purge": {
			POST: createRoute(
				withAnalytics("/users/:id/purge", "POST", handlers.handlePurgeUser),
				{
					summary: "Purge user cache",
					description:
						"Remove a specific user from the cache (requires authentication)",
					tags: ["Users", "Admin"],
					requiresAuth: true,
					parameters: {
						path: [
							pathParam(
								"id",
								"string",
								"Slack user ID to purge",
								"U062UG485EE",
							),
						],
					},
					responses: Object.fromEntries([
						apiResponse(200, "User cache purged successfully", {
							type: "object",
							properties: {
								message: { type: "string", example: "User cache purged" },
								userId: { type: "string", example: "U062UG485EE" },
								success: { type: "boolean", example: true },
							},
						}),
						apiResponse(401, "Unauthorized"),
					]),
				},
			),
		},

		"/emojis": {
			GET: createRoute(
				withAnalytics("/emojis", "GET", handlers.handleListEmojis),
				{
					summary: "List all emojis",
					description:
						"Get a list of all cached custom emojis from the Slack workspace",
					tags: ["Emojis"],
					responses: Object.fromEntries([
						apiResponse(200, "List of emojis retrieved successfully", {
							type: "array",
							items: {
								type: "object",
								properties: {
									name: { type: "string", example: "hackshark" },
									imageUrl: {
										type: "string",
										example: "https://emoji.slack-edge.com/...",
									},
									alias: { type: "string", nullable: true, example: null },
								},
							},
						}),
					]),
				},
			),
		},

		"/emojis/:name": {
			GET: createRoute(
				withAnalytics("/emojis/:name", "GET", handlers.handleGetEmoji),
				{
					summary: "Get emoji information",
					description: "Retrieve information about a specific custom emoji",
					tags: ["Emojis"],
					parameters: {
						path: [
							pathParam(
								"name",
								"string",
								"Emoji name (without colons)",
								"hackshark",
							),
						],
					},
					responses: Object.fromEntries([
						apiResponse(200, "Emoji information retrieved successfully", {
							type: "object",
							properties: {
								name: { type: "string", example: "hackshark" },
								imageUrl: {
									type: "string",
									example: "https://emoji.slack-edge.com/...",
								},
								alias: { type: "string", nullable: true, example: null },
							},
						}),
						apiResponse(404, "Emoji not found"),
					]),
				},
			),
		},

		"/emojis/:name/r": {
			GET: createRoute(
				withAnalytics("/emojis/:name/r", "GET", handlers.handleEmojiRedirect),
				{
					summary: "Redirect to emoji image",
					description: "Direct redirect to the emoji's cached image URL",
					tags: ["Emojis"],
					parameters: {
						path: [
							pathParam(
								"name",
								"string",
								"Emoji name (without colons)",
								"hackshark",
							),
						],
					},
					responses: Object.fromEntries([
						apiResponse(302, "Redirect to emoji image"),
						apiResponse(404, "Emoji not found"),
					]),
				},
			),
		},

		"/reset": {
			POST: createRoute(
				withAnalytics("/reset", "POST", handlers.handleResetCache),
				{
					summary: "Reset entire cache",
					description: "Clear all cached data (requires authentication)",
					tags: ["Admin"],
					requiresAuth: true,
					responses: Object.fromEntries([
						apiResponse(200, "Cache reset successfully", {
							type: "object",
							properties: {
								message: { type: "string", example: "Cache has been reset" },
								users: { type: "number", example: 42 },
								emojis: { type: "number", example: 1337 },
							},
						}),
						apiResponse(401, "Unauthorized"),
					]),
				},
			),
		},

		"/api/stats/essential": {
			GET: createRoute(
				withAnalytics(
					"/api/stats/essential",
					"GET",
					handlers.handleGetEssentialStats,
				),
				{
					summary: "Get essential analytics",
					description: "Fast-loading essential statistics for the dashboard",
					tags: ["Analytics"],
					parameters: {
						query: [
							queryParam(
								"days",
								"number",
								"Number of days to analyze",
								false,
								7,
							),
						],
					},
					responses: Object.fromEntries([
						apiResponse(200, "Essential stats retrieved successfully", {
							type: "object",
							properties: {
								totalRequests: { type: "number", example: 12345 },
								averageResponseTime: { type: "number", example: 23.5 },
								uptime: { type: "number", example: 99.9 },
								period: { type: "string", example: "7 days" },
							},
						}),
					]),
				},
			),
		},

		"/api/stats/charts": {
			GET: createRoute(
				withAnalytics("/api/stats/charts", "GET", handlers.handleGetChartData),
				{
					summary: "Get chart data",
					description: "Time-series data for request and latency charts",
					tags: ["Analytics"],
					parameters: {
						query: [
							queryParam(
								"days",
								"number",
								"Number of days to analyze",
								false,
								7,
							),
						],
					},
					responses: Object.fromEntries([
						apiResponse(200, "Chart data retrieved successfully", {
							type: "array",
							items: {
								type: "object",
								properties: {
									time: { type: "string", example: "2024-01-01T12:00:00Z" },
									count: { type: "number", example: 42 },
									averageResponseTime: { type: "number", example: 25.3 },
								},
							},
						}),
					]),
				},
			),
		},

		"/api/stats/useragents": {
			GET: createRoute(
				withAnalytics(
					"/api/stats/useragents",
					"GET",
					handlers.handleGetUserAgents,
				),
				{
					summary: "Get user agents statistics",
					description:
						"Cumulative list of user agents accessing the service with hit counts",
					tags: ["Analytics"],
					responses: Object.fromEntries([
						apiResponse(200, "User agents data retrieved successfully", {
							type: "array",
							items: {
								type: "object",
								properties: {
									userAgent: { type: "string", example: "Mozilla/5.0..." },
									hits: { type: "number", example: 123 },
								},
							},
						}),
					]),
				},
			),
		},

		"/stats/traffic": {
			GET: createRoute(
				withAnalytics("/stats/traffic", "GET", handlers.handleGetTraffic),
				{
					summary: "Get traffic time-series data",
					description:
						"Returns bucketed traffic data with adaptive granularity based on time range",
					tags: ["Analytics"],
					parameters: {
						query: [
							queryParam(
								"days",
								"number",
								"Number of days to look back (default: 7)",
								false,
								7,
							),
							queryParam(
								"start",
								"number",
								"Start timestamp in seconds (use with end)",
								false,
							),
							queryParam(
								"end",
								"number",
								"End timestamp in seconds (use with start)",
								false,
							),
						],
					},
					responses: Object.fromEntries([
						apiResponse(200, "Traffic data retrieved successfully", {
							type: "array",
							items: {
								type: "object",
								properties: {
									bucket: {
										type: "number",
										example: 1704067200,
										description: "Unix timestamp of bucket start",
									},
									hits: { type: "number", example: 42 },
								},
							},
						}),
					]),
				},
			),
		},

		"/stats": {
			GET: createRoute(
				withAnalytics("/stats", "GET", handlers.handleGetStats),
				{
					summary: "Get complete analytics (legacy)",
					description:
						"Legacy endpoint returning all analytics data in one response",
					tags: ["Analytics", "Legacy"],
					parameters: {
						query: [
							queryParam(
								"days",
								"number",
								"Number of days to analyze",
								false,
								7,
							),
						],
					},
					responses: Object.fromEntries([
						apiResponse(200, "Complete analytics data retrieved", {
							type: "object",
							properties: {
								totalRequests: { type: "number" },
								averageResponseTime: { type: "number" },
								chartData: { type: "array" },
								userAgents: { type: "array" },
							},
						}),
					]),
				},
			),
		},

		"/stats/essential": {
			GET: createRoute(
				withAnalytics("/stats/essential", "GET", handlers.handleGetEssentialStats),
				{
					summary: "Get essential stats",
					description: "Fast-loading essential statistics for the dashboard",
					tags: ["Analytics"],
					parameters: {
						query: [
							queryParam("days", "number", "Number of days to analyze", false, 7),
						],
					},
					responses: Object.fromEntries([
						apiResponse(200, "Essential stats retrieved", {
							type: "object",
							properties: {
								totalRequests: { type: "number" },
								averageResponseTime: { type: "number" },
								uptime: { type: "number" },
							},
						}),
					]),
				},
			),
		},

		"/stats/useragents": {
			GET: createRoute(
				withAnalytics("/stats/useragents", "GET", handlers.handleGetUserAgents),
				{
					summary: "Get user agents",
					description: "Cumulative user agent statistics",
					tags: ["Analytics"],
					responses: Object.fromEntries([
						apiResponse(200, "User agents retrieved", {
							type: "array",
							items: {
								type: "object",
								properties: {
									userAgent: { type: "string" },
									hits: { type: "number" },
								},
							},
						}),
					]),
				},
			),
		},

		"/stats/referers": {
			GET: createRoute(
				withAnalytics("/stats/referers", "GET", handlers.handleGetReferers),
				{
					summary: "Get referer sources",
					description: "Cumulative referer host statistics showing traffic sources",
					tags: ["Analytics"],
					responses: Object.fromEntries([
						apiResponse(200, "Referers retrieved", {
							type: "array",
							items: {
								type: "object",
								properties: {
									refererHost: { type: "string" },
									hits: { type: "number" },
								},
							},
						}),
					]),
				},
			),
		},
	};
}
