import type { SlackUser } from "../slack";

/**
 * Interface for Slack user provider - minimal interface Cache needs
 */
export interface SlackUserProvider {
	getUserInfo(userId: string): Promise<SlackUser>;
	testAuth(): Promise<boolean>;
}

/**
 * Base interface for cached items
 */
export interface CacheItem {
	id: string;
	imageUrl: string;
	expiration: Date;
}

/**
 * Interface for cached user data
 */
export interface User extends CacheItem {
	type: "user";
	displayName: string;
	pronouns: string;
	userId: string;
}

/**
 * Interface for cached emoji data
 */
export interface Emoji extends CacheItem {
	type: "emoji";
	name: string;
	alias: string | null;
}
