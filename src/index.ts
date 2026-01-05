import * as Sentry from "@sentry/bun";
import { serve } from "bun";
import { getEmojiUrl } from "../utils/emojiHelper";
import { SlackCache } from "./cache";
import dashboard from "./dashboard.html";
import { buildRoutes, getSwaggerSpec } from "./lib/route-builder";
import { createApiRoutes } from "./routes/api-routes";
import { SlackWrapper } from "./slackWrapper";
import swagger from "./swagger.html";

// Initialize Sentry if DSN is provided
if (process.env.SENTRY_DSN) {
  console.log("Sentry DSN provided, error monitoring is enabled");
  Sentry.init({
    environment: process.env.NODE_ENV,
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.5,
    ignoreErrors: ["Not Found", "404", "user_not_found", "emoji_not_found"],
  });
} else {
  console.warn("Sentry DSN not provided, error monitoring is disabled");
}

// Initialize SlackWrapper and Cache
const slackApp = new SlackWrapper();
const cache = new SlackCache(
  process.env.DATABASE_PATH ?? "./data/cachet.db",
  25,
  async () => {
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
  },
);

// Inject SlackWrapper into cache for background user updates
cache.setSlackWrapper(slackApp);

// Create the typed API routes with injected dependencies
const apiRoutes = createApiRoutes(cache, slackApp);

// Build Bun-compatible routes and generate Swagger
const typedRoutes = buildRoutes(apiRoutes);
const generatedSwagger = getSwaggerSpec();

// Legacy routes (non-API)
const legacyRoutes = {
  "/dashboard": dashboard,
  "/swagger": swagger,
  "/swagger.json": async (_: Request) => {
    return Response.json(generatedSwagger);
  },
  "/favicon.ico": async (_: Request) => {
    return new Response(Bun.file("./favicon.ico"));
  },

  // Root route - redirect to dashboard for browsers
  "/": async (request: Request) => {
    const userAgent = request.headers.get("user-agent") || "";

    if (
      userAgent.toLowerCase().includes("mozilla") ||
      userAgent.toLowerCase().includes("chrome") ||
      userAgent.toLowerCase().includes("safari")
    ) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/dashboard" },
      });
    }

    return new Response(
      "Hello World from Cachet 😊\n\n---\nSee /swagger for docs\nSee /dashboard for analytics\n---",
    );
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
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  development: process.env.NODE_ENV === "dev",
});

console.log(`🚀 Server running on http://localhost:${server.port}`);

// Graceful shutdown handling
const shutdown = () => {
  console.log("Shutting down gracefully...");
  cache.endUptimeSession();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export { cache, slackApp };
