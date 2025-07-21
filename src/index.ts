import { cors } from "@elysiajs/cors";
import { cron } from "@elysiajs/cron";
import { html } from "@elysiajs/html";
import { swagger } from "@elysiajs/swagger";
import * as Sentry from "@sentry/bun";
import { logger } from "@tqman/nice-logger";
import { Elysia, t } from "elysia";
import { version } from "../package.json";
import { getEmojiUrl } from "../utils/emojiHelper";
import { SlackCache } from "./cache";
import dashboard from "./dashboard.html" with { type: "text" };
import type { SlackUser } from "./slack";
import { SlackWrapper } from "./slackWrapper";

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

const app = new Elysia()
  .use(html())
  .use(
    logger({
      mode: "combined",
    }),
  )
  .use(
    cors({
      origin: true,
    }),
  )
  .derive(({ headers }) => ({
    startTime: Date.now(),
    userAgent: headers["user-agent"],
    ipAddress: headers["x-forwarded-for"] || headers["x-real-ip"] || "unknown",
  }))
  .onAfterHandle(async ({ request, set, startTime, userAgent, ipAddress }) => {
    const responseTime = Date.now() - startTime;
    const endpoint = new URL(request.url).pathname;

    // Don't track favicon or swagger requests
    if (endpoint !== "/favicon.ico" && !endpoint.startsWith("/swagger")) {
      await cache.recordRequest(
        endpoint,
        request.method,
        (set.status as number) || 200,
        userAgent,
        ipAddress,
        responseTime,
      );
    }
  })
  .use(
    cron({
      name: "heartbeat",
      pattern: "0 0 * * *",
      async run() {
        await cache.purgeAll();
      },
    }),
  )
  .use(
    cron({
      name: "purgeSpecificUserCache",
      pattern: "5 * * * *", // Run at 5 minutes after each hour
      async run() {
        const userId = "U062UG485EE";
        console.log(`Purging cache for user ${userId}`);
        const result = await cache.purgeUserCache(userId);
        console.log(
          `Cache purge for user ${userId}: ${result ? "successful" : "no cache entry found"}`,
        );
      },
    }),
  )
  .use(
    swagger({
      exclude: ["/", "favicon.ico"],
      documentation: {
        info: {
          version: version,
          title: "Cachet",
          description:
            "Hi 👋\n\nThis is a pretty simple API that acts as a middleman caching layer between slack and the outside world. There may be authentication in the future, but for now, it's just a simple cache.\n\nThe `/r` endpoints are redirects to the actual image URLs, so you can use them as direct image links.",
          contact: {
            name: "Kieran Klukas",
            email: "me@dunkirk.sh",
          },
          license: {
            name: "AGPL 3.0",
            url: "https://github.com/taciturnaxoltol/cachet/blob/master/LICENSE.md",
          },
        },
        tags: [
          {
            name: "The Cache!",
            description: "*must be read in an ominous voice*",
          },
          {
            name: "Status",
            description: "*Rather boring status endpoints :(*",
          },
        ],
      },
    }),
  )
  .onError(({ code, error, request, set }) => {
    if (error instanceof Error)
      console.error(
        `\x1b[31m x\x1b[0m unhandled error: \x1b[31m${error.message}\x1b[0m`,
      );

    // Don't send 404 errors to Sentry
    const is404 =
      set.status === 404 ||
      (error instanceof Error &&
        (error.message === "Not Found" ||
          error.message === "user_not_found" ||
          error.message === "emoji_not_found"));

    if (!is404) {
      Sentry.withScope((scope) => {
        scope.setExtra("url", request.url);
        scope.setExtra("code", code);
        Sentry.captureException(error);
      });
    }

    if (code === "VALIDATION") {
      return error.message;
    }
  })
  .get("/", ({ redirect, headers }) => {
    // check if its a browser

    if (
      headers["user-agent"]?.toLowerCase().includes("mozilla") ||
      headers["user-agent"]?.toLowerCase().includes("chrome") ||
      headers["user-agent"]?.toLowerCase().includes("safari")
    ) {
      return redirect("/dashboard", 302);
    }

    return "Hello World from Cachet 😊\n\n---\nSee /swagger for docs\nSee /dashboard for analytics\n---";
  })
  .get("/favicon.ico", Bun.file("./favicon.ico"))
  .get("/dashboard", () => dashboard)
  .get(
    "/health",
    async ({ error }) => {
      const slackConnection = await slackApp.testAuth();

      const databaseConnection = await cache.healthCheck();

      if (!slackConnection || !databaseConnection)
        return error(500, {
          http: false,
          slack: slackConnection,
          database: databaseConnection,
        });

      return {
        http: true,
        slack: true,
        database: true,
      };
    },
    {
      tags: ["Status"],
      response: {
        200: t.Object({
          http: t.Boolean(),
          slack: t.Boolean(),
          database: t.Boolean(),
        }),
        500: t.Object({
          http: t.Boolean({
            default: false,
          }),
          slack: t.Boolean({
            default: false,
          }),
          database: t.Boolean({
            default: false,
          }),
        }),
      },
    },
  )
  .get(
    "/users/:user",
    async ({ params, error, request }) => {
      const user = await cache.getUser(params.user);

      // if not found then check slack first
      if (!user || !user.imageUrl) {
        let slackUser: SlackUser;
        try {
          slackUser = await slackApp.getUserInfo(params.user);
        } catch (e) {
          if (e instanceof Error && e.message === "user_not_found")
            return error(404, { message: "User not found" });

          Sentry.withScope((scope) => {
            scope.setExtra("url", request.url);
            scope.setExtra("user", params.user);
            Sentry.captureException(e);
          });

          if (e instanceof Error)
            console.warn(
              `\x1b[38;5;214m ⚠️ WARN\x1b[0m error on fetching user from slack: \x1b[38;5;208m${e.message}\x1b[0m`,
            );

          return error(500, {
            message: `Error fetching user from Slack: ${e}`,
          });
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

        return {
          id: slackUser.id,
          expiration: new Date().toISOString(),
          user: slackUser.id,
          displayName: displayName,
          pronouns: slackUser.profile.pronouns || null,
          image: slackUser.profile.image_512,
        };
      }

      return {
        id: user.id,
        expiration: user.expiration.toISOString(),
        user: user.userId,
        displayName: user.displayName,
        pronouns: user.pronouns,
        image: user.imageUrl,
      };
    },
    {
      tags: ["The Cache!"],
      params: t.Object({
        user: t.String(),
      }),
      response: {
        404: t.Object({
          message: t.String({
            default: "User not found",
          }),
        }),
        500: t.Object({
          message: t.String({
            default: "Error fetching user from Slack",
          }),
        }),
        200: t.Object({
          id: t.String({
            default: "90750e24-c2f0-4c52-8681-e6176da6e7ab",
          }),
          expiration: t.String({
            default: new Date().toISOString(),
          }),
          user: t.String({
            default: "U12345678",
          }),
          displayName: t.String({
            default: "krn",
          }),
          pronouns: t.Nullable(t.String({ default: "possibly/blank" })),
          image: t.String({
            default:
              "https://avatars.slack-edge.com/2024-11-30/8105375749571_53898493372773a01a1f_original.jpg",
          }),
        }),
      },
    },
  )
  .get(
    "/users/:user/r",
    async ({ params, error, redirect, request }) => {
      const user = await cache.getUser(params.user);

      // if not found then check slack first
      if (!user || !user.imageUrl) {
        let slackUser: SlackUser;
        try {
          slackUser = await slackApp.getUserInfo(params.user.toUpperCase());
        } catch (e) {
          if (e instanceof Error && e.message === "user_not_found") {
            console.warn(
              `\x1b[38;5;214m ⚠️ WARN\x1b[0m user not found: \x1b[38;5;208m${params.user}\x1b[0m`,
            );

            return redirect(
              "https://api.dicebear.com/9.x/thumbs/svg?seed={username_hash}",
              307,
            );
          }

          Sentry.withScope((scope) => {
            scope.setExtra("url", request.url);
            scope.setExtra("user", params.user);
            Sentry.captureException(e);
          });

          if (e instanceof Error)
            console.warn(
              `\x1b[38;5;214m ⚠️ WARN\x1b[0m error on fetching user from slack: \x1b[38;5;208m${e.message}\x1b[0m`,
            );

          return error(500, {
            message: `Error fetching user from Slack: ${e}`,
          });
        }

        await cache.insertUser(
          slackUser.id,
          slackUser.profile.display_name_normalized ||
            slackUser.profile.real_name_normalized,
          slackUser.profile.pronouns,
          slackUser.profile.image_512,
        );

        return redirect(slackUser.profile.image_512, 302);
      }

      return redirect(user.imageUrl, 302);
    },
    {
      tags: ["The Cache!"],
      query: t.Object({
        r: t.Optional(t.String()),
      }),
      params: t.Object({
        user: t.String(),
      }),
    },
  )
  .get(
    "/emojis",
    async () => {
      const emojis = await cache.listEmojis();

      return emojis.map((emoji) => ({
        id: emoji.id,
        expiration: emoji.expiration.toISOString(),
        name: emoji.name,
        ...(emoji.alias ? { alias: emoji.alias } : {}),
        image: emoji.imageUrl,
      }));
    },
    {
      tags: ["The Cache!"],
      response: {
        200: t.Array(
          t.Object({
            id: t.String({
              default: "5427fe70-686f-4684-9da5-95d9ef4c1090",
            }),
            expiration: t.String({
              default: new Date().toISOString(),
            }),
            name: t.String({
              default: "blahaj-heart",
            }),
            alias: t.Optional(
              t.String({
                default: "blobhaj-heart",
              }),
            ),
            image: t.String({
              default:
                "https://emoji.slack-edge.com/T0266FRGM/blahaj-heart/db9adf8229e9a4fb.png",
            }),
          }),
        ),
      },
    },
  )
  .get(
    "/emojis/:emoji",
    async ({ params, error }) => {
      const emoji = await cache.getEmoji(params.emoji);

      if (!emoji) return error(404, { message: "Emoji not found" });

      return {
        id: emoji.id,
        expiration: emoji.expiration.toISOString(),
        name: emoji.name,
        ...(emoji.alias ? { alias: emoji.alias } : {}),
        image: emoji.imageUrl,
      };
    },
    {
      tags: ["The Cache!"],
      params: t.Object({
        emoji: t.String(),
      }),
      response: {
        404: t.Object({
          message: t.String({
            default: "Emoji not found",
          }),
        }),
        200: t.Object({
          id: t.String({
            default: "9ed0a560-928d-409c-89fc-10fe156299da",
          }),
          expiration: t.String({
            default: new Date().toISOString(),
          }),
          name: t.String({
            default: "orphmoji-yay",
          }),
          image: t.String({
            default:
              "https://emoji.slack-edge.com/T0266FRGM/orphmoji-yay/23a37f4af47092d3.png",
          }),
        }),
      },
    },
  )
  .get(
    "/emojis/:emoji/r",
    async ({ params, error, redirect }) => {
      const emoji = await cache.getEmoji(params.emoji);

      if (!emoji) return error(404, { message: "Emoji not found" });

      return redirect(emoji.imageUrl, 302);
    },
    {
      tags: ["The Cache!"],
      params: t.Object({
        emoji: t.String(),
      }),
    },
  )
  .post(
    "/reset",
    async ({ headers, set }) => {
      if (headers.authorization !== `Bearer ${process.env.BEARER_TOKEN}`) {
        set.status = 401;
        return "Unauthorized";
      }

      return await cache.purgeAll();
    },
    {
      tags: ["The Cache!"],
      headers: t.Object({
        authorization: t.String({
          default: "Bearer <token>",
        }),
      }),
      response: {
        200: t.Object({
          message: t.String(),
          users: t.Number(),
          emojis: t.Number(),
        }),
        401: t.String({ default: "Unauthorized" }),
      },
    },
  )
  .post(
    "/users/:user/purge",
    async ({ headers, params, set }) => {
      if (headers.authorization !== `Bearer ${process.env.BEARER_TOKEN}`) {
        set.status = 401;
        return "Unauthorized";
      }

      const success = await cache.purgeUserCache(params.user);

      return {
        message: success ? "User cache purged" : "User not found in cache",
        userId: params.user,
        success,
      };
    },
    {
      tags: ["The Cache!"],
      headers: t.Object({
        authorization: t.String({
          default: "Bearer <token>",
        }),
      }),
      params: t.Object({
        user: t.String(),
      }),
      response: {
        200: t.Object({
          message: t.String(),
          userId: t.String(),
          success: t.Boolean(),
        }),
        401: t.String({ default: "Unauthorized" }),
      },
    },
  )
  .get(
    "/stats",
    async ({ query }) => {
      const days = query.days ? parseInt(query.days) : 7;
      const analytics = await cache.getAnalytics(days);

      return analytics;
    },
    {
      tags: ["Status"],
      query: t.Object({
        days: t.Optional(
          t.String({ description: "Number of days to look back (default: 7)" }),
        ),
      }),
      response: {
        200: t.Object({
          totalRequests: t.Number(),
          requestsByEndpoint: t.Array(
            t.Object({
              endpoint: t.String(),
              count: t.Number(),
              averageResponseTime: t.Number(),
            }),
          ),
          requestsByStatus: t.Array(
            t.Object({
              status: t.Number(),
              count: t.Number(),
              averageResponseTime: t.Number(),
            }),
          ),
          requestsByDay: t.Array(
            t.Object({
              date: t.String(),
              count: t.Number(),
              averageResponseTime: t.Number(),
            }),
          ),
          averageResponseTime: t.Nullable(t.Number()),
          topUserAgents: t.Array(
            t.Object({
              userAgent: t.String(),
              count: t.Number(),
            }),
          ),
          latencyAnalytics: t.Object({
            percentiles: t.Object({
              p50: t.Nullable(t.Number()),
              p75: t.Nullable(t.Number()),
              p90: t.Nullable(t.Number()),
              p95: t.Nullable(t.Number()),
              p99: t.Nullable(t.Number()),
            }),
            distribution: t.Array(
              t.Object({
                range: t.String(),
                count: t.Number(),
                percentage: t.Number(),
              }),
            ),
            slowestEndpoints: t.Array(
              t.Object({
                endpoint: t.String(),
                averageResponseTime: t.Number(),
                count: t.Number(),
              }),
            ),
            latencyOverTime: t.Array(
              t.Object({
                time: t.String(),
                averageResponseTime: t.Number(),
                p95: t.Nullable(t.Number()),
                count: t.Number(),
              }),
            ),
          }),
          performanceMetrics: t.Object({
            uptime: t.Number(),
            errorRate: t.Number(),
            throughput: t.Number(),
            apdex: t.Number(),
            cachehitRate: t.Number(),
          }),
          peakTraffic: t.Object({
            peakHour: t.String(),
            peakRequests: t.Number(),
            peakDay: t.String(),
            peakDayRequests: t.Number(),
          }),
          dashboardMetrics: t.Object({
            statsRequests: t.Number(),
            totalWithStats: t.Number(),
          }),
          trafficOverview: t.Array(
            t.Object({
              time: t.String(),
              routes: t.Record(t.String(), t.Number()),
              total: t.Number(),
            }),
          ),
        }),
      },
    },
  )
  .listen(process.env.PORT ?? 3000);

console.log(
  `\n---\n\n🦊 Elysia is running at http://${app.server?.hostname}:${app.server?.port} on v${version}@${process.env.NODE_ENV}\n\n---\n`,
);
