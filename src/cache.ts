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
  userId: string;
}

/**
 * Interface for cached emoji data
 */
interface Emoji extends CacheItem {
  type: "emoji";
  name: string;
}

type CacheTypes = User | Emoji;

/**
 * Cache class for storing user and emoji data with automatic expiration
 */
class Cache {
  private db: Database;
  private defaultExpiration: number; // in hours

  /**
   * Creates a new Cache instance
   * @param dbPath Path to SQLite database file
   * @param defaultExpirationHours Default cache expiration in hours
   */
  constructor(dbPath: string, defaultExpirationHours = 24) {
    this.db = new Database(dbPath);
    this.defaultExpiration = defaultExpirationHours;

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
        imageUrl TEXT,
        expiration INTEGER
      )
    `);

    // Create emojis table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS emojis (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE,
        imageUrl TEXT,
        expiration INTEGER
      )
    `);
  }

  /**
   * Sets up hourly purge of expired items
   * @private
   */
  private setupPurgeSchedule() {
    // Run purge every hour
    schedule("0 * * * *", () => {
      this.purgeExpiredItems();
    });
  }

  /**
   * Removes expired items from the cache
   * @private
   */
  private purgeExpiredItems() {
    const now = Date.now();

    this.db.run("DELETE FROM users WHERE expiration < ?", [now]);
    this.db.run("DELETE FROM emojis WHERE expiration < ?", [now]);
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
  async insertUser(userId: string, imageUrl: string, expirationHours?: number) {
    const id = crypto.randomUUID();
    const expiration =
      Date.now() + (expirationHours || this.defaultExpiration) * 3600000;

    try {
      this.db.run(
        "INSERT INTO users (id, userId, imageUrl, expiration) VALUES (?, ?, ?, ?)",
        [id, userId, imageUrl, expiration],
      );
      return true;
    } catch (error) {
      console.error("Error inserting user:", error);
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
  async insertEmoji(name: string, imageUrl: string, expirationHours?: number) {
    const id = crypto.randomUUID();
    const expiration =
      Date.now() + (expirationHours || this.defaultExpiration) * 3600000;

    try {
      this.db.run(
        "INSERT INTO emojis (id, name, imageUrl, expiration) VALUES (?, ?, ?, ?)",
        [id, name, imageUrl, expiration],
      );
      return true;
    } catch (error) {
      console.error("Error inserting emoji:", error);
      return false;
    }
  }

  /**
   * Retrieves a user from the cache
   * @param userId Unique identifier of the user
   * @returns User object if found and not expired, null otherwise
   */
  async getUser(userId: string): Promise<User | null> {
    const result = this.db
      .query("SELECT * FROM users WHERE userId = ? AND expiration > ?")
      .get(userId, Date.now()) as User;

    return result
      ? {
          type: "user",
          id: result.id,
          userId: result.userId,
          imageUrl: result.imageUrl,
          expiration: new Date(result.expiration),
        }
      : null;
  }

  /**
   * Retrieves an emoji from the cache
   * @param name Name of the emoji
   * @returns Emoji object if found and not expired, null otherwise
   */
  async getEmoji(name: string): Promise<Emoji | null> {
    const result = this.db
      .query("SELECT * FROM emojis WHERE name = ? AND expiration > ?")
      .get(name, Date.now()) as Emoji;

    return result
      ? {
          type: "emoji",
          id: result.id,
          name: result.name,
          imageUrl: result.imageUrl,
          expiration: new Date(result.expiration),
        }
      : null;
  }
}

export { Cache as SlackCache };
