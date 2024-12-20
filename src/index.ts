import { Elysia, t } from "elysia";
import { logger } from "@tqman/nice-logger";
import { swagger } from "@elysiajs/swagger";
import { cors } from "@elysiajs/cors";
import { version } from "../package.json";
import { SlackCache } from "./cache";
import { SlackWrapper } from "./slackWrapper";
import type { SlackUser } from "./slack";
import { getEmojiUrl } from "../utils/emojiHelper";
import * as Sentry from "@sentry/bun";

if (process.env.SENTRY_DSN) {
  console.log("Sentry DSN provided, error monitoring is enabled");
  Sentry.init({
    environment: process.env.NODE_ENV,
    dsn: process.env.SENTRY_DSN, // Replace with your Sentry DSN
    tracesSampleRate: 1.0, // Adjust this value for performance monitoring
  });
} else {
  console.warn("Sentry DSN not provided, error monitoring is disabled");
}

const slackApp = new SlackWrapper();

const cache = new SlackCache(
  process.env.DATABASE_PATH ?? "./data/cachet.db",
  24,
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
  .use(
    logger({
      mode: "combined",
    }),
  )
  .use(cors())
  .use(
    swagger({
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
  .onError(({ code, error, request }) => {
    if (error instanceof Error)
      console.error(
        `\x1b[31m x\x1b[0m unhandled error: \x1b[31m${error.message}\x1b[0m`,
      );
    Sentry.withScope((scope) => {
      scope.setExtra("url", request.url);
      scope.setExtra("code", code);
      Sentry.captureException(error);
    });
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
      return redirect("/swagger", 302);
    }

    return "Hello World from Cachet 😊\n\n---\nSee /swagger for docs\n---";
  })
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

        await cache.insertUser(
          slackUser.id,
          slackUser.profile.display_name_normalized,
          slackUser.profile.image_512,
        );

        return {
          id: slackUser.id,
          expiration: new Date().toISOString(),
          user: slackUser.id,
          displayName: slackUser.profile.display_name_normalized,
          image: slackUser.profile.image_512,
        };
      }

      return {
        id: user.id,
        expiration: user.expiration.toISOString(),
        user: user.userId,
        displayName: user.displayName,
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
          slackUser = await slackApp.getUserInfo(params.user);
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

        await cache.insertUser(slackUser.id, slackUser.profile.image_512);

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
  .listen(process.env.PORT ?? 3000);

console.log(
  `\n---\n\n🦊 Elysia is running at http://${app.server?.hostname}:${app.server?.port} on v${version}@${process.env.NODE_ENV}\n\n---\n`,
);
