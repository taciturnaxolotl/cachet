/**
 * Centralized configuration. Parses all environment variables once at startup,
 * validates required values, and exports a frozen typed config object.
 */

export interface AppConfig {
	readonly port: number;
	readonly databasePath: string;
	readonly development: boolean;
	readonly bearerToken: string | null;
	readonly slack: {
		readonly signingSecret: string;
		readonly botToken: string;
		readonly maxConcurrent: number;
		readonly minTimeMs: number;
		readonly requestTimeoutMs: number;
	};
}

export function parsePositiveInt(value: string | undefined, fallback: number): number {
	if (!value) return fallback;
	const n = Number.parseInt(value, 10);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

function loadConfig(): AppConfig {
	const errors: string[] = [];

	const signingSecret = process.env.SLACK_SIGNING_SECRET || "";
	const botToken = process.env.SLACK_BOT_TOKEN || process.env.SLACK_TOKEN || "";

	if (!signingSecret) {
		errors.push("SLACK_SIGNING_SECRET is required");
	}
	if (!botToken) {
		errors.push("SLACK_BOT_TOKEN (or SLACK_TOKEN) is required");
	}

	const portRaw = process.env.PORT;
	let port = 3000;
	if (portRaw) {
		port = Number.parseInt(portRaw, 10);
		if (!Number.isFinite(port) || port <= 0 || port > 65535) {
			errors.push(`PORT must be a valid port number (1-65535), got "${portRaw}"`);
			port = 3000;
		}
	}

	const bearerToken = process.env.BEARER_TOKEN || null;
	if (!bearerToken) {
		console.warn("BEARER_TOKEN is not set. Admin endpoints (/reset, /users/:id/purge) will return 500.");
	}

	if (errors.length > 0) {
		throw new Error(`Configuration errors:\n  - ${errors.join("\n  - ")}`);
	}

	const config: AppConfig = {
		port,
		databasePath: process.env.DATABASE_PATH ?? "./data/cachet.db",
		development: process.env.NODE_ENV === "dev",
		bearerToken,
		slack: {
			signingSecret,
			botToken,
			maxConcurrent: parsePositiveInt(process.env.SLACK_MAX_CONCURRENT, 3),
			minTimeMs: parsePositiveInt(process.env.SLACK_MIN_TIME_MS, 200),
			requestTimeoutMs: parsePositiveInt(process.env.SLACK_REQUEST_TIMEOUT_MS, 5000),
		},
	};

	return Object.freeze(config);
}

export const config = loadConfig();
