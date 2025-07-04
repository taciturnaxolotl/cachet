import { Database } from "bun:sqlite";
import { schedule } from "node-cron";

/**
 * @fileoverview This file contains the Cache class for storing user and emoji data with automatic expiration. To use the module in your project, import the default export and create a new instance of the Cache class. The class provides methods for inserting and retrieving user and emoji data from the cache. The cache automatically purges expired items every hour.
 * @module cache
 * @requires bun:sqlite
 * @requires node-cron
 */

/**
 * Base interface for cached items
 */
interface CacheItem {
  id: string;
  imageUrl: string;
  expiration: Date;
}

/**
 * Interface for cached user data
 */
interface User extends CacheItem {
  type: "user";
  displayName: string;
  pronouns: string;
  userId: string;
}

/**
 * Interface for cached emoji data
 */
interface Emoji extends CacheItem {
  type: "emoji";
  name: string;
  alias: string | null;
}

type CacheTypes = User | Emoji;

/**
 * Cache class for storing user and emoji data with automatic expiration
 */
class Cache {
  private db: Database;
  private defaultExpiration: number; // in hours
  private onEmojiExpired?: () => void;

  /**
   * Creates a new Cache instance
   * @param dbPath Path to SQLite database file
   * @param defaultExpirationHours Default cache expiration in hours
   * @param onEmojiExpired Optional callback function called when emojis expire
   */
  constructor(
    dbPath: string,
    defaultExpirationHours = 24,
    onEmojiExpired?: () => void,
  ) {
    this.db = new Database(dbPath);
    this.defaultExpiration = defaultExpirationHours;
    this.onEmojiExpired = onEmojiExpired;

    this.initDatabase();
    this.setupPurgeSchedule();
  }

  /**
   * Initializes the database tables
   * @private
   */
  private initDatabase() {
    // Create users table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        userId TEXT UNIQUE,
        displayName TEXT,
        pronouns TEXT,
        imageUrl TEXT,
        expiration INTEGER
      )
    `);

    // Create emojis table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS emojis (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE,
        alias TEXT,
        imageUrl TEXT,
        expiration INTEGER
      )
    `);

    // check if there are any emojis in the db
    if (this.onEmojiExpired) {
      const result = this.db
        .query("SELECT COUNT(*) as count FROM emojis WHERE expiration > ?")
        .get(Date.now()) as { count: number };
      if (result.count === 0) {
        this.onEmojiExpired();
      }
    }
  }

  /**
   * Sets up hourly purge of expired items
   * @private
   */
  private setupPurgeSchedule() {
    // Run purge every hour
    schedule("45 * * * *", async () => {
      await this.purgeExpiredItems();
    });
  }

  /**
   * Purges expired items from the cache
   * @returns int indicating number of items purged
   */
  async purgeExpiredItems(): Promise<number> {
    const result = this.db.run("DELETE FROM users WHERE expiration < ?", [
      Date.now(),
    ]);
    const result2 = this.db.run("DELETE FROM emojis WHERE expiration < ?", [
      Date.now(),
    ]);

    if (this.onEmojiExpired) {
      if (result2.changes > 0) {
        this.onEmojiExpired();
      }
    }

    return result.changes + result2.changes;
  }

  /**
   * Purges cache for a specific user
   * @param userId The Slack user ID to purge from cache
   * @returns boolean indicating if any user was purged
   */
  async purgeUserCache(userId: string): Promise<boolean> {
    try {
      const result = this.db.run("DELETE FROM users WHERE userId = ?", [
        userId.toUpperCase(),
      ]);
      return result.changes > 0;
    } catch (error) {
      console.error("Error purging user cache:", error);
      return false;
    }
  }

  /**
   * Purges all items from the cache
   * @returns Object containing purge results
   */
  async purgeAll(): Promise<{
    message: string;
    users: number;
    emojis: number;
  }> {
    const result = this.db.run("DELETE FROM users");
    const result2 = this.db.run("DELETE FROM emojis");

    if (this.onEmojiExpired) {
      if (result2.changes > 0) {
        this.onEmojiExpired();
      }
    }

    return {
      message: "Cache purged",
      users: result.changes,
      emojis: result2.changes,
    };
  }

  /**
   * Checks if the cache is healthy by testing database connectivity
   * @returns boolean indicating if cache is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      this.db.query("SELECT 1").get();
      return true;
    } catch (error) {
      console.error("Cache health check failed:", error);
      return false;
    }
  }

  /**
   * Inserts a user into the cache
   * @param userId Unique identifier for the user
   * @param imageUrl URL of the user's image
   * @param expirationHours Optional custom expiration time in hours
   * @returns boolean indicating success
   */
  async insertUser(
    userId: string,
    displayName: string,
    pronouns: string,
    imageUrl: string,
    expirationHours?: number,
  ) {
    const id = crypto.randomUUID();
    const expiration =
      Date.now() + (expirationHours || this.defaultExpiration) * 3600000;

    try {
      this.db.run(
        `INSERT INTO users (id, userId, displayName, pronouns, imageUrl, expiration)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(userId)
           DO UPDATE SET imageUrl = ?, expiration = ?`,
        [
          id,
          userId.toUpperCase(),
          displayName,
          pronouns,
          imageUrl,
          expiration,
          imageUrl,
          expiration,
        ],
      );
      return true;
    } catch (error) {
      console.error("Error inserting/updating user:", error);
      return false;
    }
  }

  /**
   * Inserts an emoji into the cache
   * @param name Name of the emoji
   * @param imageUrl URL of the emoji image
   * @param expirationHours Optional custom expiration time in hours
   * @returns boolean indicating success
   */
  async insertEmoji(
    name: string,
    alias: string | null,
    imageUrl: string,
    expirationHours?: number,
  ) {
    const id = crypto.randomUUID();
    const expiration =
      Date.now() + (expirationHours || this.defaultExpiration) * 3600000;

    try {
      this.db.run(
        `INSERT INTO emojis (id, name, alias, imageUrl, expiration)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(name)
          DO UPDATE SET imageUrl = ?, expiration = ?`,
        [
          id,
          name.toLowerCase(),
          alias?.toLowerCase() || null,
          imageUrl,
          expiration,
          imageUrl,
          expiration,
        ],
      );
      return true;
    } catch (error) {
      console.error("Error inserting/updating emoji:", error);
      return false;
    }
  }

  /**
   * Batch inserts multiple emojis into the cache
   * @param emojis Array of {name, imageUrl} objects to insert
   * @param expirationHours Optional custom expiration time in hours for all emojis
   * @returns boolean indicating if all insertions were successful
   */
  async batchInsertEmojis(
    emojis: Array<{ name: string; imageUrl: string; alias: string | null }>,
    expirationHours?: number,
  ): Promise<boolean> {
    try {
      const expiration =
        Date.now() + (expirationHours || this.defaultExpiration) * 3600000;

      this.db.transaction(() => {
        for (const emoji of emojis) {
          const id = crypto.randomUUID();
          this.db.run(
            `INSERT INTO emojis (id, name, alias, imageUrl, expiration)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(name)
             DO UPDATE SET imageUrl = ?, expiration = ?`,
            [
              id,
              emoji.name.toLowerCase(),
              emoji.alias?.toLowerCase() || null,
              emoji.imageUrl,
              expiration,
              emoji.imageUrl,
              expiration,
            ],
          );
        }
      })();

      return true;
    } catch (error) {
      console.error("Error batch inserting emojis:", error);
      return false;
    }
  }

  /**
   * Lists all emoji in the cache
   * @returns Array of Emoji objects that haven't expired
   */
  async listEmojis(): Promise<Emoji[]> {
    const results = this.db
      .query("SELECT * FROM emojis WHERE expiration > ?")
      .all(Date.now()) as Emoji[];

    return results.map((result) => ({
      type: "emoji",
      id: result.id,
      name: result.name,
      alias: result.alias || null,
      imageUrl: result.imageUrl,
      expiration: new Date(result.expiration),
    }));
  }

  /**
   * Retrieves a user from the cache
   * @param userId Unique identifier of the user
   * @returns User object if found and not expired, null otherwise
   */
  async getUser(userId: string): Promise<User | null> {
    const result = this.db
      .query("SELECT * FROM users WHERE userId = ?")
      .get(userId.toUpperCase()) as User;

    if (!result) {
      return null;
    }

    if (new Date(result.expiration).getTime() < Date.now()) {
      this.db.run("DELETE FROM users WHERE userId = ?", [userId]);
      return null;
    }

    return {
      type: "user",
      id: result.id,
      userId: result.userId,
      displayName: result.displayName,
      pronouns: result.pronouns,
      imageUrl: result.imageUrl,
      expiration: new Date(result.expiration),
    };
  }

  /**
   * Retrieves an emoji from the cache
   * @param name Name of the emoji
   * @returns Emoji object if found and not expired, null otherwise
   */
  async getEmoji(name: string): Promise<Emoji | null> {
    const result = this.db
      .query("SELECT * FROM emojis WHERE name = ? AND expiration > ?")
      .get(name.toLowerCase(), Date.now()) as Emoji;

    return result
      ? {
          type: "emoji",
          id: result.id,
          name: result.name,
          alias: result.alias || null,
          imageUrl: result.imageUrl,
          expiration: new Date(result.expiration),
        }
      : null;
  }
}

export { Cache as SlackCache };
