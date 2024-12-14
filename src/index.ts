import { Elysia, t } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { version } from "../package.json";
import { SlackApp } from "slack-edge";
import { SlackCache } from "./cache";

if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_SIGNING_SECRET) {
  const missingEnvVars = [
    !process.env.SLACK_BOT_TOKEN && "SLACK_BOT_TOKEN",
    !process.env.SLACK_SIGNING_SECRET && "SLACK_SIGNING_SECRET",
  ].filter(Boolean);

  throw new Error(
    `Missing required environment variables: ${missingEnvVars.join(", ")}`,
  );
}

const slackApp = new SlackApp({
  env: {
    SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
    SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
    SLACK_LOGGING_LEVEL: "INFO",
  },
  startLazyListenerAfterAck: true,
});

const cache = new SlackCache();

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
      const slackConnection = await slackApp.client.auth.test();

      const databaseConnection = await cache.healthCheck();

      if (!slackConnection.ok || !databaseConnection)
        return error(500, {
          http: false,
          slack: slackConnection.ok,
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

      if (!user) return error(404, { message: "User not found" });

      return {
        id: user.id,
        expiration: user.expiration.toISOString(),
        user: user.userId,
        image: user.imageUrl,
      };
    },
    {
      tags: ["Users"],
      params: t.Object({
        user: t.String(),
      }),
      response: {
        404: t.Object({
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
  .listen(3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port} at ${version}`,
);
