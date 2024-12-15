import { Elysia, t } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { version } from "../package.json";
import { SlackCache } from "./cache";
import { SlackWrapper } from "./slackWrapper";
import type { SlackUser } from "./slack";
import { getEmojiUrl } from "../utils/emojiHelper";

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
    swagger({
      documentation: {
        info: {
          version: version,
          title: "Cachet",
          description: "Cachet API Documentation",
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
            description: "Status routes",
          },
        ],
      },
    }),
  )
  .get(
    "/",
    () => "Hello World from Cachet 😊\n\n---\nSee /swagger for docs\n---",
    {
      tags: ["Status"],
      response: {
        200: t.String({
          default:
            "Hello World from Cachet 😊\n\n---\nSee /swagger for docs\n---",
        }),
      },
    },
  )
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
    async ({ params, error }) => {
      const user = await cache.getUser(params.user);

      // if not found then check slack first
      if (!user) {
        let slackUser: SlackUser;
        try {
          slackUser = await slackApp.getUserInfo(params.user);
        } catch (e) {
          if (e instanceof Error && e.message === "user_not_found")
            return error(404, { message: "User not found" });

          return error(500, {
            message: `Error fetching user from Slack: ${e}`,
          });
        }

        await cache.insertUser(slackUser.id, slackUser.profile.image_original);

        return {
          id: slackUser.id,
          expiration: new Date().toISOString(),
          user: slackUser.id,
          image: slackUser.profile.image_original,
        };
      }

      return {
        id: user.id,
        expiration: user.expiration.toISOString(),
        user: user.userId,
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
    async ({ params, error, redirect }) => {
      const user = await cache.getUser(params.user);

      // if not found then check slack first
      if (!user) {
        let slackUser: SlackUser;
        try {
          slackUser = await slackApp.getUserInfo(params.user);
        } catch (e) {
          if (e instanceof Error && e.message === "user_not_found")
            return error(404, { message: "User not found" });

          return error(500, {
            message: `Error fetching user from Slack: ${e}`,
          });
        }

        await cache.insertUser(slackUser.id, slackUser.profile.image_original);

        return redirect(slackUser.profile.image_original, 302);
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
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port} at ${version}`,
);
