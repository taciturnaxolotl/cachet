import { Elysia, t } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { version } from "../package.json";
import { SlackApp } from "slack-edge";

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
      // TODO: Check slack connection and database connection
      const slackConnection = await slackApp.client.auth.test();

      if (!slackConnection.ok)
        error(500, {
          http: false,
          slack: slackConnection.ok,
          database: false,
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
  .listen(3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port} at ${version}`,
);
