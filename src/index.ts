import { serve } from "bun";
import * as Sentry from "@sentry/bun";
import { SlackCache } from "./cache";
import { SlackWrapper } from "./slackWrapper";
import { getEmojiUrl } from "../utils/emojiHelper";
import type { SlackUser } from "./slack";
import swaggerSpec from "./swagger";
import dashboard from "./dashboard.html";
import swagger from "./swagger.html";

// Initialize Sentry if DSN is provided
if (process.env.SENTRY_DSN) {
  console.log("Sentry DSN provided, error monitoring is enabled");
  Sentry.init({
    environment: process.env.NODE_ENV,
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.5,
    ignoreErrors: [
      // Ignore all 404-related errors
      "Not Found",
      "404",
      "user_not_found",
      "emoji_not_found",
    ],
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
          const aliasName = url.substring(6); // Remove 'alias:' prefix
          const aliasUrl = emojis[aliasName] ?? getEmojiUrl(aliasName) ?? null;

          if (aliasUrl === null) {
            console.warn(`Could not find alias for ${aliasName}`);
            return;
          }

          return {
            name,
            imageUrl: aliasUrl === null ? getEmojiUrl(aliasName) : aliasUrl,
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
          entry !== undefined,
      );

    console.log("Batch inserting emojis");
    await cache.batchInsertEmojis(emojiEntries);
    console.log("Finished batch inserting emojis");
  },
);

// Setup cron jobs
setupCronJobs();

// Start the server
const server = serve({
  routes: {
    // HTML routes
    "/dashboard": dashboard,
    "/swagger": swagger,
    "/swagger.json": async (request) => {
      return Response.json(swaggerSpec);
    },
    "/favicon.ico": async (request) => {
      return new Response(Bun.file("./favicon.ico"));
    },

    // Root route - redirect to dashboard for browsers
    "/": async (request) => {
      const startTime = Date.now();
      const recordAnalytics = async (statusCode: number) => {
        const userAgent = request.headers.get("user-agent") || "";
        const ipAddress =
          request.headers.get("x-forwarded-for") ||
          request.headers.get("x-real-ip") ||
          "unknown";

        await cache.recordRequest(
          "/",
          request.method,
          statusCode,
          userAgent,
          ipAddress,
          Date.now() - startTime,
        );
      };

      const userAgent = request.headers.get("user-agent") || "";
      if (
        userAgent.toLowerCase().includes("mozilla") ||
        userAgent.toLowerCase().includes("chrome") ||
        userAgent.toLowerCase().includes("safari")
      ) {
        recordAnalytics(302);
        return new Response(null, {
          status: 302,
          headers: { Location: "/dashboard" },
        });
      }

      recordAnalytics(200);
      return new Response(
        "Hello World from Cachet 😊\n\n---\nSee /swagger for docs\nSee /dashboard for analytics\n---",
      );
    },

    // Health check endpoint
    "/health": {
      async GET(request) {
        const startTime = Date.now();
        const recordAnalytics = async (statusCode: number) => {
          const userAgent = request.headers.get("user-agent") || "";
          const ipAddress =
            request.headers.get("x-forwarded-for") ||
            request.headers.get("x-real-ip") ||
            "unknown";

          await cache.recordRequest(
            "/health",
            "GET",
            statusCode,
            userAgent,
            ipAddress,
            Date.now() - startTime,
          );
        };

        return handleHealthCheck(request, recordAnalytics);
      },
    },

    // User endpoints
    "/users/:id": {
      async GET(request) {
        const startTime = Date.now();
        const recordAnalytics = async (statusCode: number) => {
          const userAgent = request.headers.get("user-agent") || "";
          const ipAddress =
            request.headers.get("x-forwarded-for") ||
            request.headers.get("x-real-ip") ||
            "unknown";

          await cache.recordRequest(
            request.url,
            "GET",
            statusCode,
            userAgent,
            ipAddress,
            Date.now() - startTime,
          );
        };

        return handleGetUser(request, recordAnalytics);
      },
    },

    "/users/:id/r": {
      async GET(request) {
        const startTime = Date.now();
        const recordAnalytics = async (statusCode: number) => {
          const userAgent = request.headers.get("user-agent") || "";
          const ipAddress =
            request.headers.get("x-forwarded-for") ||
            request.headers.get("x-real-ip") ||
            "unknown";

          await cache.recordRequest(
            request.url,
            "GET",
            statusCode,
            userAgent,
            ipAddress,
            Date.now() - startTime,
          );
        };

        return handleUserRedirect(request, recordAnalytics);
      },
    },

    "/users/:id/purge": {
      async POST(request) {
        const startTime = Date.now();
        const recordAnalytics = async (statusCode: number) => {
          const userAgent = request.headers.get("user-agent") || "";
          const ipAddress =
            request.headers.get("x-forwarded-for") ||
            request.headers.get("x-real-ip") ||
            "unknown";

          await cache.recordRequest(
            request.url,
            "POST",
            statusCode,
            userAgent,
            ipAddress,
            Date.now() - startTime,
          );
        };

        return handlePurgeUser(request, recordAnalytics);
      },
    },

    // Emoji endpoints
    "/emojis": {
      async GET(request) {
        const startTime = Date.now();
        const recordAnalytics = async (statusCode: number) => {
          const userAgent = request.headers.get("user-agent") || "";
          const ipAddress =
            request.headers.get("x-forwarded-for") ||
            request.headers.get("x-real-ip") ||
            "unknown";

          await cache.recordRequest(
            "/emojis",
            "GET",
            statusCode,
            userAgent,
            ipAddress,
            Date.now() - startTime,
          );
        };

        return handleListEmojis(request, recordAnalytics);
      },
    },

    "/emojis/:name": {
      async GET(request) {
        const startTime = Date.now();
        const recordAnalytics = async (statusCode: number) => {
          const userAgent = request.headers.get("user-agent") || "";
          const ipAddress =
            request.headers.get("x-forwarded-for") ||
            request.headers.get("x-real-ip") ||
            "unknown";

          await cache.recordRequest(
            request.url,
            "GET",
            statusCode,
            userAgent,
            ipAddress,
            Date.now() - startTime,
          );
        };

        return handleGetEmoji(request, recordAnalytics);
      },
    },

    "/emojis/:name/r": {
      async GET(request) {
        const startTime = Date.now();
        const recordAnalytics = async (statusCode: number) => {
          const userAgent = request.headers.get("user-agent") || "";
          const ipAddress =
            request.headers.get("x-forwarded-for") ||
            request.headers.get("x-real-ip") ||
            "unknown";

          await cache.recordRequest(
            request.url,
            "GET",
            statusCode,
            userAgent,
            ipAddress,
            Date.now() - startTime,
          );
        };

        return handleEmojiRedirect(request, recordAnalytics);
      },
    },

    // Reset cache endpoint
    "/reset": {
      async POST(request) {
        const startTime = Date.now();
        const recordAnalytics = async (statusCode: number) => {
          const userAgent = request.headers.get("user-agent") || "";
          const ipAddress =
            request.headers.get("x-forwarded-for") ||
            request.headers.get("x-real-ip") ||
            "unknown";

          await cache.recordRequest(
            "/reset",
            "POST",
            statusCode,
            userAgent,
            ipAddress,
            Date.now() - startTime,
          );
        };

        return handleResetCache(request, recordAnalytics);
      },
    },

    // Stats endpoint
    "/stats": {
      async GET(request) {
        const startTime = Date.now();
        const recordAnalytics = async (statusCode: number) => {
          const userAgent = request.headers.get("user-agent") || "";
          const ipAddress =
            request.headers.get("x-forwarded-for") ||
            request.headers.get("x-real-ip") ||
            "unknown";

          await cache.recordRequest(
            "/stats",
            "GET",
            statusCode,
            userAgent,
            ipAddress,
            Date.now() - startTime,
          );
        };

        return handleGetStats(request, recordAnalytics);
      },
    },
  },

  // Enable development mode for hot reloading
  development: {
    hmr: true,
    console: true,
  },

  // Fallback fetch handler for unmatched routes and error handling
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const startTime = Date.now();

    // Record request analytics (except for favicon and swagger)
    const recordAnalytics = async (statusCode: number) => {
      if (path !== "/favicon.ico" && !path.startsWith("/swagger")) {
        const userAgent = request.headers.get("user-agent") || "";
        const ipAddress =
          request.headers.get("x-forwarded-for") ||
          request.headers.get("x-real-ip") ||
          "unknown";

        await cache.recordRequest(
          path,
          method,
          statusCode,
          userAgent,
          ipAddress,
          Date.now() - startTime,
        );
      }
    };

    try {
      // Not found
      recordAnalytics(404);
      return new Response("Not Found", { status: 404 });
    } catch (error) {
      console.error(
        `\x1b[31m x\x1b[0m unhandled error: \x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m`,
      );

      // Don't send 404 errors to Sentry
      const is404 =
        error instanceof Error &&
        (error.message === "Not Found" ||
          error.message === "user_not_found" ||
          error.message === "emoji_not_found");

      if (!is404 && error instanceof Error) {
        Sentry.withScope((scope) => {
          scope.setExtra("url", request.url);
          Sentry.captureException(error);
        });
      }

      recordAnalytics(500);
      return new Response("Internal Server Error", { status: 500 });
    }
  },

  port: process.env.PORT ? parseInt(process.env.PORT) : 3000,
});

console.log(
  `\n---\n\n🐰 Bun server is running at ${server.url} on ${process.env.NODE_ENV}\n\n---\n`,
);

// Handler functions
async function handleHealthCheck(
  request: Request,
  recordAnalytics: (statusCode: number) => Promise<void>,
) {
  const slackConnection = await slackApp.testAuth();
  const databaseConnection = await cache.healthCheck();

  if (!slackConnection || !databaseConnection) {
    await recordAnalytics(500);
    return Response.json(
      {
        http: false,
        slack: slackConnection,
        database: databaseConnection,
      },
      { status: 500 },
    );
  }

  await recordAnalytics(200);
  return Response.json({
    http: true,
    slack: true,
    database: true,
  });
}

async function handleGetUser(
  request: Request,
  recordAnalytics: (statusCode: number) => Promise<void>,
) {
  const url = new URL(request.url);
  const userId = url.pathname.split("/").pop() || "";
  const user = await cache.getUser(userId);

  // If not found then check slack first
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

      if (e instanceof Error)
        console.warn(
          `\x1b[38;5;214m ⚠️ WARN\x1b[0m error on fetching user from slack: \x1b[38;5;208m${e.message}\x1b[0m`,
        );

      await recordAnalytics(500);
      return Response.json(
        { message: `Error fetching user from Slack: ${e}` },
        { status: 500 },
      );
    }

    const displayName =
      slackUser.profile.display_name_normalized ||
      slackUser.profile.real_name_normalized;

    await cache.insertUser(
      slackUser.id,
      displayName,
      slackUser.profile.pronouns,
      slackUser.profile.image_512,
    );

    await recordAnalytics(200);
    return Response.json({
      id: slackUser.id,
      expiration: new Date().toISOString(),
      user: slackUser.id,
      displayName: displayName,
      pronouns: slackUser.profile.pronouns || null,
      image: slackUser.profile.image_512,
    });
  }

  await recordAnalytics(200);
  return Response.json({
    id: user.id,
    expiration: user.expiration.toISOString(),
    user: user.userId,
    displayName: user.displayName,
    pronouns: user.pronouns,
    image: user.imageUrl,
  });
}

async function handleUserRedirect(
  request: Request,
  recordAnalytics: (statusCode: number) => Promise<void>,
) {
  const url = new URL(request.url);
  const parts = url.pathname.split("/");
  const userId = parts[2] || "";
  const user = await cache.getUser(userId);

  // If not found then check slack first
  if (!user || !user.imageUrl) {
    let slackUser: SlackUser;
    try {
      slackUser = await slackApp.getUserInfo(userId.toUpperCase());
    } catch (e) {
      if (e instanceof Error && e.message === "user_not_found") {
        console.warn(
          `\x1b[38;5;214m ⚠️ WARN\x1b[0m user not found: \x1b[38;5;208m${userId}\x1b[0m`,
        );

        await recordAnalytics(307);
        return new Response(null, {
          status: 307,
          headers: {
            Location:
              "https://api.dicebear.com/9.x/thumbs/svg?seed={username_hash}",
          },
        });
      }

      Sentry.withScope((scope) => {
        scope.setExtra("url", request.url);
        scope.setExtra("user", userId);
        Sentry.captureException(e);
      });

      if (e instanceof Error)
        console.warn(
          `\x1b[38;5;214m ⚠️ WARN\x1b[0m error on fetching user from slack: \x1b[38;5;208m${e.message}\x1b[0m`,
        );

      await recordAnalytics(500);
      return Response.json(
        { message: `Error fetching user from Slack: ${e}` },
        { status: 500 },
      );
    }

    await cache.insertUser(
      slackUser.id,
      slackUser.profile.display_name_normalized ||
        slackUser.profile.real_name_normalized,
      slackUser.profile.pronouns,
      slackUser.profile.image_512,
    );

    await recordAnalytics(302);
    return new Response(null, {
      status: 302,
      headers: { Location: slackUser.profile.image_512 },
    });
  }

  await recordAnalytics(302);
  return new Response(null, {
    status: 302,
    headers: { Location: user.imageUrl },
  });
}

async function handleListEmojis(
  request: Request,
  recordAnalytics: (statusCode: number) => Promise<void>,
) {
  const emojis = await cache.listEmojis();

  await recordAnalytics(200);
  return Response.json(
    emojis.map((emoji) => ({
      id: emoji.id,
      expiration: emoji.expiration.toISOString(),
      name: emoji.name,
      ...(emoji.alias ? { alias: emoji.alias } : {}),
      image: emoji.imageUrl,
    })),
  );
}

async function handleGetEmoji(
  request: Request,
  recordAnalytics: (statusCode: number) => Promise<void>,
) {
  const url = new URL(request.url);
  const emojiName = url.pathname.split("/").pop() || "";
  const emoji = await cache.getEmoji(emojiName);

  if (!emoji) {
    const fallbackUrl = getEmojiUrl(emojiName);
    if (!fallbackUrl) {
      await recordAnalytics(404);
      return Response.json({ message: "Emoji not found" }, { status: 404 });
    }

    await recordAnalytics(200);
    return Response.json({
      id: null,
      expiration: new Date().toISOString(),
      name: emojiName,
      image: fallbackUrl,
    });
  }

  await recordAnalytics(200);
  return Response.json({
    id: emoji.id,
    expiration: emoji.expiration.toISOString(),
    name: emoji.name,
    ...(emoji.alias ? { alias: emoji.alias } : {}),
    image: emoji.imageUrl,
  });
}

async function handleEmojiRedirect(
  request: Request,
  recordAnalytics: (statusCode: number) => Promise<void>,
) {
  const url = new URL(request.url);
  const parts = url.pathname.split("/");
  const emojiName = parts[2] || "";
  const emoji = await cache.getEmoji(emojiName);

  if (!emoji) {
    const fallbackUrl = getEmojiUrl(emojiName);
    if (!fallbackUrl) {
      await recordAnalytics(404);
      return Response.json({ message: "Emoji not found" }, { status: 404 });
    }

    await recordAnalytics(302);
    return new Response(null, {
      status: 302,
      headers: { Location: fallbackUrl },
    });
  }

  await recordAnalytics(302);
  return new Response(null, {
    status: 302,
    headers: { Location: emoji.imageUrl },
  });
}

async function handleResetCache(
  request: Request,
  recordAnalytics: (statusCode: number) => Promise<void>,
) {
  const authHeader = request.headers.get("authorization") || "";

  if (authHeader !== `Bearer ${process.env.BEARER_TOKEN}`) {
    await recordAnalytics(401);
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await cache.purgeAll();
  await recordAnalytics(200);
  return Response.json(result);
}

async function handlePurgeUser(
  request: Request,
  recordAnalytics: (statusCode: number) => Promise<void>,
) {
  const authHeader = request.headers.get("authorization") || "";

  if (authHeader !== `Bearer ${process.env.BEARER_TOKEN}`) {
    await recordAnalytics(401);
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const parts = url.pathname.split("/");
  const userId = parts[2] || "";
  const success = await cache.purgeUserCache(userId);

  await recordAnalytics(200);
  return Response.json({
    message: success ? "User cache purged" : "User not found in cache",
    userId: userId,
    success,
  });
}

async function handleGetStats(
  request: Request,
  recordAnalytics: (statusCode: number) => Promise<void>,
) {
  const url = new URL(request.url);
  const params = new URLSearchParams(url.search);
  const days = params.get("days") ? parseInt(params.get("days")!) : 7;
  const analytics = await cache.getAnalytics(days);

  await recordAnalytics(200);
  return Response.json(analytics);
}

// Setup cron jobs for cache maintenance
function setupCronJobs() {
  // Daily purge of all expired items
  const dailyPurge = setInterval(async () => {
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() === 0) {
      await cache.purgeAll();
    }
  }, 60 * 1000); // Check every minute

  // Hourly purge of specific user cache
  const hourlyUserPurge = setInterval(async () => {
    const now = new Date();
    if (now.getMinutes() === 5) {
      const userId = "U062UG485EE";
      console.log(`Purging cache for user ${userId}`);
      const result = await cache.purgeUserCache(userId);
      console.log(
        `Cache purge for user ${userId}: ${result ? "successful" : "no cache entry found"}`,
      );
    }
  }, 60 * 1000); // Check every minute

  // Clean up on process exit
  process.on("exit", () => {
    clearInterval(dailyPurge);
    clearInterval(hourlyUserPurge);
  });
}
