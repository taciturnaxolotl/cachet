import { serve } from "bun";
import { version } from "../package.json";

// Define the Swagger specification
const swaggerSpec = {
  openapi: "3.0.0",
  info: {
    title: "Cachet",
    version: version,
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
  paths: {
    "/users/{user}": {
      get: {
        tags: ["The Cache!"],
        summary: "Get user information",
        description:
          "Retrieves user information from the cache or from Slack if not cached",
        parameters: [
          {
            name: "user",
            in: "path",
            required: true,
            schema: {
              type: "string",
            },
            description: "Slack user ID",
          },
        ],
        responses: {
          "200": {
            description: "User information",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    id: {
                      type: "string",
                      example: "90750e24-c2f0-4c52-8681-e6176da6e7ab",
                    },
                    expiration: {
                      type: "string",
                      format: "date-time",
                      example: new Date().toISOString(),
                    },
                    user: {
                      type: "string",
                      example: "U12345678",
                    },
                    displayName: {
                      type: "string",
                      example: "krn",
                    },
                    pronouns: {
                      type: "string",
                      nullable: true,
                      example: "possibly/blank",
                    },
                    image: {
                      type: "string",
                      example:
                        "https://avatars.slack-edge.com/2024-11-30/8105375749571_53898493372773a01a1f_original.jpg",
                    },
                  },
                },
              },
            },
          },
          "404": {
            description: "User not found",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: {
                      type: "string",
                      example: "User not found",
                    },
                  },
                },
              },
            },
          },
          "500": {
            description: "Error fetching user from Slack",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: {
                      type: "string",
                      example: "Error fetching user from Slack",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/users/{user}/r": {
      get: {
        tags: ["The Cache!"],
        summary: "Redirect to user profile image",
        description: "Redirects to the user's profile image URL",
        parameters: [
          {
            name: "user",
            in: "path",
            required: true,
            schema: {
              type: "string",
            },
            description: "Slack user ID",
          },
        ],
        responses: {
          "302": {
            description: "Redirect to user profile image",
          },
          "307": {
            description: "Redirect to default image when user not found",
          },
          "500": {
            description: "Error fetching user from Slack",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: {
                      type: "string",
                      example: "Error fetching user from Slack",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/users/{user}/purge": {
      post: {
        tags: ["The Cache!"],
        summary: "Purge user cache",
        description: "Purges a specific user's cache",
        parameters: [
          {
            name: "user",
            in: "path",
            required: true,
            schema: {
              type: "string",
            },
            description: "Slack user ID",
          },
          {
            name: "authorization",
            in: "header",
            required: true,
            schema: {
              type: "string",
              example: "Bearer <token>",
            },
            description: "Bearer token for authentication",
          },
        ],
        responses: {
          "200": {
            description: "User cache purged",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: {
                      type: "string",
                      example: "User cache purged",
                    },
                    userId: {
                      type: "string",
                      example: "U12345678",
                    },
                    success: {
                      type: "boolean",
                      example: true,
                    },
                  },
                },
              },
            },
          },
          "401": {
            description: "Unauthorized",
            content: {
              "text/plain": {
                schema: {
                  type: "string",
                  example: "Unauthorized",
                },
              },
            },
          },
        },
      },
    },
    "/emojis": {
      get: {
        tags: ["The Cache!"],
        summary: "Get all emojis",
        description: "Retrieves all emojis from the cache",
        responses: {
          "200": {
            description: "List of emojis",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: {
                        type: "string",
                        example: "5427fe70-686f-4684-9da5-95d9ef4c1090",
                      },
                      expiration: {
                        type: "string",
                        format: "date-time",
                        example: new Date().toISOString(),
                      },
                      name: {
                        type: "string",
                        example: "blahaj-heart",
                      },
                      alias: {
                        type: "string",
                        nullable: true,
                        example: "blobhaj-heart",
                      },
                      image: {
                        type: "string",
                        example:
                          "https://emoji.slack-edge.com/T0266FRGM/blahaj-heart/db9adf8229e9a4fb.png",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/emojis/{emoji}": {
      get: {
        tags: ["The Cache!"],
        summary: "Get emoji information",
        description: "Retrieves information about a specific emoji",
        parameters: [
          {
            name: "emoji",
            in: "path",
            required: true,
            schema: {
              type: "string",
            },
            description: "Emoji name",
          },
        ],
        responses: {
          "200": {
            description: "Emoji information",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    id: {
                      type: "string",
                      example: "9ed0a560-928d-409c-89fc-10fe156299da",
                    },
                    expiration: {
                      type: "string",
                      format: "date-time",
                      example: new Date().toISOString(),
                    },
                    name: {
                      type: "string",
                      example: "orphmoji-yay",
                    },
                    image: {
                      type: "string",
                      example:
                        "https://emoji.slack-edge.com/T0266FRGM/orphmoji-yay/23a37f4af47092d3.png",
                    },
                  },
                },
              },
            },
          },
          "404": {
            description: "Emoji not found",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: {
                      type: "string",
                      example: "Emoji not found",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/emojis/{emoji}/r": {
      get: {
        tags: ["The Cache!"],
        summary: "Redirect to emoji image",
        description: "Redirects to the emoji image URL",
        parameters: [
          {
            name: "emoji",
            in: "path",
            required: true,
            schema: {
              type: "string",
            },
            description: "Emoji name",
          },
        ],
        responses: {
          "302": {
            description: "Redirect to emoji image",
          },
          "404": {
            description: "Emoji not found",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: {
                      type: "string",
                      example: "Emoji not found",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/reset": {
      post: {
        tags: ["The Cache!"],
        summary: "Reset cache",
        description: "Purges all items from the cache",
        parameters: [
          {
            name: "authorization",
            in: "header",
            required: true,
            schema: {
              type: "string",
              example: "Bearer <token>",
            },
            description: "Bearer token for authentication",
          },
        ],
        responses: {
          "200": {
            description: "Cache purged",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: {
                      type: "string",
                      example: "Cache purged",
                    },
                    users: {
                      type: "number",
                      example: 10,
                    },
                    emojis: {
                      type: "number",
                      example: 100,
                    },
                  },
                },
              },
            },
          },
          "401": {
            description: "Unauthorized",
            content: {
              "text/plain": {
                schema: {
                  type: "string",
                  example: "Unauthorized",
                },
              },
            },
          },
        },
      },
    },
    "/health": {
      get: {
        tags: ["Status"],
        summary: "Health check",
        description:
          "Checks the health of the API, Slack connection, and database",
        responses: {
          "200": {
            description: "Health check passed",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    http: {
                      type: "boolean",
                      example: true,
                    },
                    slack: {
                      type: "boolean",
                      example: true,
                    },
                    database: {
                      type: "boolean",
                      example: true,
                    },
                  },
                },
              },
            },
          },
          "500": {
            description: "Health check failed",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    http: {
                      type: "boolean",
                      example: false,
                    },
                    slack: {
                      type: "boolean",
                      example: false,
                    },
                    database: {
                      type: "boolean",
                      example: false,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/stats": {
      get: {
        tags: ["Status"],
        summary: "Get analytics statistics",
        description: "Retrieves analytics statistics for the API",
        parameters: [
          {
            name: "days",
            in: "query",
            required: false,
            schema: {
              type: "string",
            },
            description: "Number of days to look back (default: 7)",
          },
        ],
        responses: {
          "200": {
            description: "Analytics statistics",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    totalRequests: {
                      type: "number",
                    },
                    requestsByEndpoint: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          endpoint: {
                            type: "string",
                          },
                          count: {
                            type: "number",
                          },
                          averageResponseTime: {
                            type: "number",
                          },
                        },
                      },
                    },
                    // Additional properties omitted for brevity
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

// Export the Swagger specification for use in other files
export default swaggerSpec;
