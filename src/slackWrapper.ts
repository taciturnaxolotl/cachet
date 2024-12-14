import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  SlackEmojiListResponse,
  SlackUser,
  SlackUserInfoResponse,
} from "./slack";

/**
 * Interface for mapping emoji names to their URLs
 */
interface SlackEmoji {
  [key: string]: string;
}

/**
 * Configuration options for initializing the SlackWrapper
 */
interface SlackConfig {
  /** Slack signing secret for request verification */
  signingSecret?: string;
  /** Slack bot user OAuth token */
  botToken?: string;
}

/**
 * Wrapper class for Slack API interactions
 */
class SlackWrapper {
  private signingSecret: string;
  private botToken: string;

  /**
   * Creates a new SlackWrapper instance
   * @param config Optional configuration object containing signing secret and bot token
   * @throws Error if required credentials are missing
   */
  constructor(config?: SlackConfig) {
    this.signingSecret =
      config?.signingSecret || process.env.SLACK_SIGNING_SECRET || "";
    this.botToken = config?.botToken || process.env.SLACK_BOT_TOKEN || "";

    const missingFields = [];
    if (!this.signingSecret) missingFields.push("signing secret");
    if (!this.botToken) missingFields.push("bot token");

    if (missingFields.length > 0) {
      throw new Error(
        `Missing required Slack credentials: ${missingFields.join(" and ")} either pass them to the class or set them as environment variables`,
      );
    }
  }

  /**
   * Tests authentication with current credentials
   * @returns Promise resolving to true if auth is valid
   * @throws Error if authentication fails
   */
  async testAuth(): Promise<boolean> {
    const response = await fetch("https://slack.com/api/auth.test", {
      headers: {
        Authorization: `Bearer ${this.botToken}`,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();
    if (!data.ok) {
      throw new Error(`Authentication failed: ${data.error}`);
    }

    return true;
  }

  /**
   * Retrieves information about a Slack user
   * @param userId The ID of the user to look up
   * @returns Promise resolving to the user's information
   * @throws Error if the API request fails
   */
  async getUserInfo(userId: string): Promise<SlackUser> {
    const response = await fetch(
      `https://slack.com/api/users.info?user=${userId}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ user: userId }),
      },
    );

    const data: SlackUserInfoResponse = await response.json();
    if ((!data.ok && data.error !== "user_not_found") || !data.user) {
      throw new Error(data.error);
    }

    return data.user;
  }

  /**
   * Retrieves the list of custom emojis from the Slack workspace
   * @returns Promise resolving to the emoji list
   * @throws Error if the API request fails
   */
  async getEmojiList(): Promise<Record<string, string>> {
    const response = await fetch("https://slack.com/api/emoji.list", {
      headers: {
        Authorization: `Bearer ${this.botToken}`,
        "Content-Type": "application/json",
      },
    });

    const data: SlackEmojiListResponse = await response.json();
    if (!data.ok || !data.emoji) {
      throw new Error(`Failed to get emoji list: ${data.error}`);
    }

    return data.emoji;
  }

  /**
   * Verifies a Slack request signature
   * @param signature The signature from the request header
   * @param timestamp The timestamp from the request header
   * @param body The raw request body
   * @returns boolean indicating if the signature is valid
   */
  verifySignature(signature: string, timestamp: string, body: string): boolean {
    const baseString = `v0:${timestamp}:${body}`;
    const hmac = createHmac("sha256", this.signingSecret);
    const computedSignature = `v0=${hmac.update(baseString).digest("hex")}`;
    return timingSafeEqual(
      Buffer.from(signature).valueOf() as Uint8Array,
      Buffer.from(computedSignature).valueOf() as Uint8Array,
    );
  }
}

export { SlackWrapper };
