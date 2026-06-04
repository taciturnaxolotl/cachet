import { serve } from "bun";
import { config } from "./config";
import { getEmojiUrl } from "../utils/emojiHelper";
import { SlackCache } from "./cache";
import dashboard from "./dashboard.html";
import { swaggerGenerator } from "./lib/swagger-generator";
import { addCorsHeaders, corsPreflightResponse } from "./lib/cors";
import type { RouteDefinition } from "./types/routes";
import { createApiRoutes } from "./routes/api-routes";
import { SlackWrapper } from "./slackWrapper";
import swagger from "./swagger.html";
import faviconFile from "../favicon.ico";

// Initialize SlackWrapper and Cache
const slackApp = new SlackWrapper({
	signingSecret: config.slack.signingSecret,
	botToken: config.slack.botToken,
	maxConcurrent: config.slack.maxConcurrent,
	minTimeMs: config.slack.minTimeMs,
	requestTimeoutMs: config.slack.requestTimeoutMs,
});
const cache = new SlackCache(config.databasePath, 25, async () => {
	console.log("Fetching emojis from Slack");
	const emojis = await slackApp.getEmojiList();
	const emojiEntries = Object.entries(emojis)
		.map(([name, url]) => {
			if (typeof url === "string" && url.startsWith("alias:")) {
				const aliasName = url.substring(6);
				const aliasUrl = emojis[aliasName] ?? getEmojiUrl(aliasName);

				if (!aliasUrl) {
					console.warn(`Could not find alias for ${aliasName}`);
					return null;
				}

				return {
					name,
					imageUrl: aliasUrl,
					alias: aliasName,
				};
			}
			return {
				name,
				imageUrl: url,
				alias: null,
			};
		})
		.filter(
			(
				entry,
			): entry is { name: string; imageUrl: string; alias: string | null } =>
				entry !== null,
		);

	console.log("Batch inserting emojis");
	await cache.batchInsertEmojis(emojiEntries);
	console.log("Finished batch inserting emojis");
});

// Inject SlackWrapper into cache for background user updates
cache.setSlackWrapper(slackApp);

// Create the typed API routes with injected dependencies
const apiRoutes = createApiRoutes(cache, slackApp);

// Generate Swagger and convert typed routes to Bun format
swaggerGenerator.addRoutes(apiRoutes as Record<string, RouteDefinition>);
const generatedSwagger = swaggerGenerator.getSpec();

const typedRoutes: Record<
	string,
	Record<string, (request: Request) => Promise<Response> | Response>
> = {};
for (const [path, routeConfig] of Object.entries(
	apiRoutes as Record<string, RouteDefinition>,
)) {
	const bunRoute: Record<
		string,
		(request: Request) => Promise<Response> | Response
	> = {};
	for (const [method, typedRoute] of Object.entries(routeConfig)) {
		if (typedRoute && "handler" in typedRoute) {
			bunRoute[method] = typedRoute.handler;
		}
	}
	typedRoutes[path] = bunRoute;
}

// Legacy routes (non-API)
const legacyRoutes = {
	"/dashboard": dashboard,
	"/swagger": swagger,
	"/swagger.json": async (_: Request) => {
		const response = Response.json(generatedSwagger);
		return addCorsHeaders(response);
	},
	"/favicon.ico": async (_: Request) => {
		const response = new Response(faviconFile);
		return addCorsHeaders(response);
	},

	// Root route - redirect to dashboard for browsers
	"/": async (request: Request) => {
		// Handle OPTIONS preflight
		if (request.method === "OPTIONS") {
			return corsPreflightResponse();
		}

		const userAgent = request.headers.get("user-agent") || "";

		if (
			userAgent.toLowerCase().includes("mozilla") ||
			userAgent.toLowerCase().includes("chrome") ||
			userAgent.toLowerCase().includes("safari")
		) {
			const response = new Response(null, {
				status: 302,
				headers: { Location: "/dashboard" },
			});
			return addCorsHeaders(response);
		}

		const response = new Response(
			"Hello World from Cachet 😊\n\n---\nSee /swagger for docs\nSee /dashboard for analytics\n---",
		);
		return addCorsHeaders(response);
	},
};

// Merge all routes
const allRoutes = {
	...legacyRoutes,
	...typedRoutes,
};

// Start the server
const server = serve({
	routes: allRoutes,
	port: config.port,
	development: config.development,
});

console.log(`🚀 Server running on http://localhost:${server.port}`);

// Graceful shutdown handling
let shuttingDown = false;
const shutdown = () => {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log("Shutting down gracefully...");
	server.stop();
	cache.close();
	console.log("Shutdown complete");
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

process.on("unhandledRejection", (reason) => {
	console.error("Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (error) => {
	console.error("Uncaught exception:", error);
	process.exit(1);
});

export { cache, slackApp };
