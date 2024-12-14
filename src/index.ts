import { Elysia, t } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { version } from "../package.json";
import { SlackCache } from "./cache";
import { SlackWrapper } from "./slackWrapper";
import type { SlackUser } from "./slack";

const slackApp = new SlackWrapper();

const cache = new SlackCache(
  process.env.DATABASE_PATH ?? "./data/cachet.db",
  24,
  async () => {
    console.log("Fetching emojis from Slack");
    const emojis = await slackApp.getEmojiList();
    const emojiEntries = Object.entries(emojis).map(([name, url]) => ({
      name,
      imageUrl: url,
    }));

    console.log("Batch inserting emojis");

    await cache.batchInsertEmoji(emojiEntries);

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
            name: "Auth",
            description: "Authentication routes",
          },
          {
            name: "Slack",
            description: "Slack routes",
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
      tags: ["Slack"],
      params: t.Object({
        user: t.String(),
      }),
      response: {
        404: t.Object({
          message: t.String(),
        }),
        500: t.Object({
          message: t.String(),
        }),
        200: t.Object({
          id: t.String(),
          expiration: t.String(),
          user: t.String(),
          image: t.String(),
        }),
      },
    },
  )
  .get(
    "/emojis",
    async () => {
      const emojis = await cache.listEmoji();

      return emojis.map((emoji) => ({
        id: emoji.id,
        expiration: emoji.expiration.toISOString(),
        name: emoji.name,
        image: emoji.imageUrl,
      }));
    },
    {
      tags: ["Slack"],
      response: {
        200: t.Array(
          t.Object({
            id: t.String(),
            expiration: t.String(),
            name: t.String(),
            image: t.String(),
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
        image: emoji.imageUrl,
      };
    },
    {
      tags: ["Slack"],
      params: t.Object({
        emoji: t.String(),
      }),
      response: {
        404: t.Object({
          message: t.String(),
        }),
        200: t.Object({
          id: t.String(),
          expiration: t.String(),
          name: t.String(),
          image: t.String(),
        }),
      },
    },
  )
  .listen(process.env.PORT ?? 3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port} at ${version}`,
);
