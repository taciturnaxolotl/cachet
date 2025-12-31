import { createHmac, timingSafeEqual } from "node:crypto";
import Bottleneck from "bottleneck";
import type {
	SlackEmojiListResponse,
	SlackUser,
	SlackUserInfoResponse,
} from "./slack";

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
	private limiter: Bottleneck;

	/**
	 * Creates a new SlackWrapper instance
	 * @param config Optional configuration object containing signing secret and bot token
	 * @throws Error if required credentials are missing
	 */
	constructor(config?: SlackConfig) {
		this.signingSecret =
			config?.signingSecret || process.env.SLACK_SIGNING_SECRET || "";
		this.botToken =
			config?.botToken ||
			process.env.SLACK_BOT_TOKEN ||
			process.env.SLACK_TOKEN ||
			"";

		// Configure rate limiting - defaults are conservative to respect Slack API limits
		const maxConcurrent = Number(process.env.SLACK_MAX_CONCURRENT ?? 3);
		const minTime = Number(process.env.SLACK_MIN_TIME_MS ?? 200); // ~5 requests per second
		this.limiter = new Bottleneck({
			maxConcurrent: Number.isFinite(maxConcurrent) && maxConcurrent > 0 ? maxConcurrent : 3,
			minTime: Number.isFinite(minTime) && minTime > 0 ? minTime : 200,
		});

		const missingFields = [];
		if (!this.signingSecret) missingFields.push("signing secret");
		if (!this.botToken) missingFields.push("bot token");

		if (missingFields.length > 0) {
			throw new Error(
				`Missing required Slack credentials: ${missingFields.join(" and ")} either pass them to the class or set them as environment variables (SLACK_BOT_TOKEN or SLACK_TOKEN)`,
			);
		}
	}

	/**
	 * Tests authentication with current credentials
	 * @returns Promise resolving to true if auth is valid
	 * @throws Error if authentication fails
	 */
	async testAuth(): Promise<boolean> {
		const response = await this.limiter.schedule(() =>
			fetch("https://slack.com/api/auth.test", {
				headers: {
					Authorization: `Bearer ${this.botToken}`,
					"Content-Type": "application/json",
				},
			}),
		);

		const data = (await response.json()) as {
			ok: boolean;
			error: string | null;
		};
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
		const response = await this.limiter.schedule(() =>
			fetch(`https://slack.com/api/users.info?user=${userId}`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.botToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ user: userId }),
			}),
		);

		const data = (await response.json()) as SlackUserInfoResponse;
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
		const response = await this.limiter.schedule(() =>
			fetch("https://slack.com/api/emoji.list", {
				headers: {
					Authorization: `Bearer ${this.botToken}`,
					"Content-Type": "application/json",
				},
			}),
		);

		const data = (await response.json()) as SlackEmojiListResponse;
		if (!data.ok || !data.emoji) {
			throw new Error(`Failed to get emoji list: ${data.error}`);
		}

		return data.emoji;
	}

	/**
	 * Verifies a Slack request signature with timestamp freshness check
	 * @param signature The signature from the request header (x-slack-signature)
	 * @param timestamp The timestamp from the request header (x-slack-request-timestamp)
	 * @param body The raw request body
	 * @param maxAgeSeconds Maximum age of timestamp in seconds (default: 5 minutes)
	 * @returns boolean indicating if the signature is valid
	 */
	verifySignature(
		signature: string,
		timestamp: string,
		body: string,
		maxAgeSeconds: number = 300,
	): boolean {
		if (!signature || !timestamp) {
			return false;
		}

		// Reject old timestamps to prevent replay attacks
		const ts = Number(timestamp);
		if (!Number.isFinite(ts)) {
			return false;
		}

		const now = Math.floor(Date.now() / 1000);
		if (Math.abs(now - ts) > maxAgeSeconds) {
			return false;
		}

		const baseString = `v0:${timestamp}:${body}`;
		const hmac = createHmac("sha256", this.signingSecret);
		const expected = `v0=${hmac.update(baseString).digest("hex")}`;

		// Ensure equal length before timingSafeEqual to avoid exception
		if (expected.length !== signature.length) {
			return false;
		}

		return timingSafeEqual(
			Buffer.from(signature, "utf8"),
			Buffer.from(expected, "utf8"),
		);
	}
}

export { SlackWrapper };
