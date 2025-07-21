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

    // Create request analytics table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS request_analytics (
        id TEXT PRIMARY KEY,
        endpoint TEXT NOT NULL,
        method TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        user_agent TEXT,
        ip_address TEXT,
        timestamp INTEGER NOT NULL,
        response_time INTEGER
      )
    `);

    // Create index for faster queries
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_request_analytics_timestamp
      ON request_analytics(timestamp)
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_request_analytics_endpoint
      ON request_analytics(endpoint)
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

    // Clean up old analytics data (older than 30 days)
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    this.db.run("DELETE FROM request_analytics WHERE timestamp < ?", [
      thirtyDaysAgo,
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

  /**
   * Records a request for analytics
   * @param endpoint The endpoint that was accessed
   * @param method HTTP method
   * @param statusCode HTTP status code
   * @param userAgent User agent string
   * @param ipAddress IP address of the client
   * @param responseTime Response time in milliseconds
   */
  async recordRequest(
    endpoint: string,
    method: string,
    statusCode: number,
    userAgent?: string,
    ipAddress?: string,
    responseTime?: number,
  ): Promise<void> {
    try {
      const id = crypto.randomUUID();
      this.db.run(
        `INSERT INTO request_analytics
         (id, endpoint, method, status_code, user_agent, ip_address, timestamp, response_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          endpoint,
          method,
          statusCode,
          userAgent || null,
          ipAddress || null,
          Date.now(),
          responseTime || null,
        ],
      );
    } catch (error) {
      console.error("Error recording request analytics:", error);
    }
  }

  /**
   * Gets request analytics statistics
   * @param days Number of days to look back (default: 7)
   * @returns Analytics data
   */
  async getAnalytics(days: number = 7): Promise<{
    totalRequests: number;
    requestsByEndpoint: Array<{
      endpoint: string;
      count: number;
      averageResponseTime: number;
    }>;
    requestsByStatus: Array<{
      status: number;
      count: number;
      averageResponseTime: number;
    }>;
    requestsByDay: Array<{
      date: string;
      count: number;
      averageResponseTime: number;
    }>;
    averageResponseTime: number | null;
    topUserAgents: Array<{ userAgent: string; count: number }>;
    latencyAnalytics: {
      percentiles: {
        p50: number | null;
        p75: number | null;
        p90: number | null;
        p95: number | null;
        p99: number | null;
      };
      distribution: Array<{
        range: string;
        count: number;
        percentage: number;
      }>;
      slowestEndpoints: Array<{
        endpoint: string;
        averageResponseTime: number;
        count: number;
      }>;
      latencyOverTime: Array<{
        time: string;
        averageResponseTime: number;
        p95: number | null;
        count: number;
      }>;
    };
    performanceMetrics: {
      uptime: number;
      errorRate: number;
      throughput: number;
      apdex: number;
      cachehitRate: number;
    };
    peakTraffic: {
      peakHour: string;
      peakRequests: number;
      peakDay: string;
      peakDayRequests: number;
    };
    dashboardMetrics: {
      statsRequests: number;
      totalWithStats: number;
    };
    trafficOverview: Array<{
      time: string;
      routes: Record<string, number>;
      total: number;
    }>;
  }> {
    const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;

    // Total requests (excluding stats endpoint)
    const totalResult = this.db
      .query(
        "SELECT COUNT(*) as count FROM request_analytics WHERE timestamp > ? AND endpoint != '/stats'",
      )
      .get(cutoffTime) as { count: number };

    // Stats endpoint requests (tracked separately)
    const statsResult = this.db
      .query(
        "SELECT COUNT(*) as count FROM request_analytics WHERE timestamp > ? AND endpoint = '/stats'",
      )
      .get(cutoffTime) as { count: number };

    // Get raw endpoint data and group them intelligently (excluding stats)
    const rawEndpointResults = this.db
      .query(
        `
         SELECT endpoint, COUNT(*) as count, AVG(response_time) as averageResponseTime
         FROM request_analytics
         WHERE timestamp > ? AND endpoint != '/stats'
         GROUP BY endpoint
         ORDER BY count DESC
       `,
      )
      .all(cutoffTime) as Array<{
      endpoint: string;
      count: number;
      averageResponseTime: number | null;
    }>;

    // Group endpoints intelligently
    const endpointGroups: Record<
      string,
      { count: number; totalResponseTime: number; requestCount: number }
    > = {};

    for (const result of rawEndpointResults) {
      const endpoint = result.endpoint;
      let groupKey: string;

      if (endpoint === "/" || endpoint === "/dashboard") {
        groupKey = "Dashboard";
      } else if (endpoint === "/health") {
        groupKey = "Health Check";
      } else if (endpoint === "/swagger" || endpoint.startsWith("/swagger")) {
        groupKey = "API Documentation";
      } else if (endpoint === "/emojis") {
        groupKey = "Emoji List";
      } else if (endpoint.match(/^\/emojis\/[^\/]+$/)) {
        groupKey = "Emoji Data";
      } else if (endpoint.match(/^\/emojis\/[^\/]+\/r$/)) {
        groupKey = "Emoji Redirects";
      } else if (endpoint.match(/^\/users\/[^\/]+$/)) {
        groupKey = "User Data";
      } else if (endpoint.match(/^\/users\/[^\/]+\/r$/)) {
        groupKey = "User Redirects";
      } else if (endpoint.match(/^\/users\/[^\/]+\/purge$/)) {
        groupKey = "Cache Management";
      } else if (endpoint === "/reset") {
        groupKey = "Cache Management";
      } else {
        groupKey = endpoint; // Keep as-is for unknown endpoints
      }

      if (!endpointGroups[groupKey]) {
        endpointGroups[groupKey] = {
          count: 0,
          totalResponseTime: 0,
          requestCount: 0,
        };
      }

      // Defensive: Only update if groupKey exists (should always exist due to initialization above)
      const group = endpointGroups[groupKey];
      if (group) {
        group.count += result.count;
        if (
          result.averageResponseTime !== null &&
          result.averageResponseTime !== undefined
        ) {
          group.totalResponseTime += result.averageResponseTime * result.count;
          group.requestCount += result.count;
        }
      }
    }

    // Convert back to array format with calculated averages
    const requestsByEndpoint = Object.entries(endpointGroups)
      .map(([endpoint, data]) => ({
        endpoint,
        count: data.count,
        averageResponseTime:
          data.requestCount > 0
            ? data.totalResponseTime / data.requestCount
            : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // Requests by status code with average response time (excluding stats)
    const statusResultsRaw = this.db
      .query(
        `
         SELECT status_code as status, COUNT(*) as count, AVG(response_time) as averageResponseTime
         FROM request_analytics
         WHERE timestamp > ? AND endpoint != '/stats'
         GROUP BY status_code
         ORDER BY count DESC
       `,
      )
      .all(cutoffTime) as Array<{
      status: number;
      count: number;
      averageResponseTime: number | null;
    }>;

    const statusResults = statusResultsRaw.map((s) => ({
      status: s.status,
      count: s.count,
      averageResponseTime: s.averageResponseTime ?? 0,
    }));

    // Requests over time - hourly for 1 day, daily for longer periods
    let timeResults: Array<{
      date: string;
      count: number;
      averageResponseTime: number;
    }>;

    if (days === 1) {
      // Hourly data for last 24 hours (excluding stats)
      const hourResultsRaw = this.db
        .query(
          `
           SELECT
             strftime('%Y-%m-%d %H:00', datetime(timestamp / 1000, 'unixepoch')) as date,
             COUNT(*) as count,
             AVG(response_time) as averageResponseTime
           FROM request_analytics
           WHERE timestamp > ? AND endpoint != '/stats'
           GROUP BY strftime('%Y-%m-%d %H:00', datetime(timestamp / 1000, 'unixepoch'))
           ORDER BY date ASC
         `,
        )
        .all(cutoffTime) as Array<{
        date: string;
        count: number;
        averageResponseTime: number | null;
      }>;

      timeResults = hourResultsRaw.map((h) => ({
        date: h.date,
        count: h.count,
        averageResponseTime: h.averageResponseTime ?? 0,
      }));
    } else {
      // Daily data for longer periods (excluding stats)
      const dayResultsRaw = this.db
        .query(
          `
           SELECT
             DATE(timestamp / 1000, 'unixepoch') as date,
             COUNT(*) as count,
             AVG(response_time) as averageResponseTime
           FROM request_analytics
           WHERE timestamp > ? AND endpoint != '/stats'
           GROUP BY DATE(timestamp / 1000, 'unixepoch')
           ORDER BY date ASC
         `,
        )
        .all(cutoffTime) as Array<{
        date: string;
        count: number;
        averageResponseTime: number | null;
      }>;

      timeResults = dayResultsRaw.map((d) => ({
        date: d.date,
        count: d.count,
        averageResponseTime: d.averageResponseTime ?? 0,
      }));
    }

    // Average response time (excluding stats)
    const avgResponseResult = this.db
      .query(
        `
         SELECT AVG(response_time) as avg
         FROM request_analytics
         WHERE timestamp > ? AND response_time IS NOT NULL AND endpoint != '/stats'
       `,
      )
      .get(cutoffTime) as { avg: number | null };

    // Top user agents (simplified and grouped, excluding stats)
    const rawUserAgentResults = this.db
      .query(
        `
         SELECT user_agent as userAgent, COUNT(*) as count
         FROM request_analytics
         WHERE timestamp > ? AND user_agent IS NOT NULL AND endpoint != '/stats'
         GROUP BY user_agent
         ORDER BY count DESC
         LIMIT 20
       `,
      )
      .all(cutoffTime) as Array<{ userAgent: string; count: number }>;

    // Group user agents intelligently
    const userAgentGroups: Record<string, number> = {};

    for (const result of rawUserAgentResults) {
      const ua = result.userAgent.toLowerCase();
      let groupKey: string;

      if (ua.includes("chrome") && !ua.includes("edg")) {
        groupKey = "Chrome";
      } else if (ua.includes("firefox")) {
        groupKey = "Firefox";
      } else if (ua.includes("safari") && !ua.includes("chrome")) {
        groupKey = "Safari";
      } else if (ua.includes("edg")) {
        groupKey = "Edge";
      } else if (ua.includes("curl")) {
        groupKey = "curl";
      } else if (ua.includes("wget")) {
        groupKey = "wget";
      } else if (ua.includes("postman")) {
        groupKey = "Postman";
      } else if (
        ua.includes("bot") ||
        ua.includes("crawler") ||
        ua.includes("spider")
      ) {
        groupKey = "Bots/Crawlers";
      } else if (ua.includes("python")) {
        groupKey = "Python Scripts";
      } else if (
        ua.includes("node") ||
        ua.includes("axios") ||
        ua.includes("fetch")
      ) {
        groupKey = "API Clients";
      } else {
        groupKey = "Other";
      }

      userAgentGroups[groupKey] =
        (userAgentGroups[groupKey] || 0) + result.count;
    }

    // Convert back to array format, sorted by count
    const topUserAgents = Object.entries(userAgentGroups)
      .map(([userAgent, count]) => ({ userAgent, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Enhanced Latency Analytics

    // Get all response times for percentile calculations (excluding stats)
    const responseTimes = this.db
      .query(
        `
         SELECT response_time
         FROM request_analytics
         WHERE timestamp > ? AND response_time IS NOT NULL AND endpoint != '/stats'
         ORDER BY response_time
       `,
      )
      .all(cutoffTime) as Array<{ response_time: number }>;

    // Calculate percentiles
    const calculatePercentile = (
      arr: number[],
      percentile: number,
    ): number | null => {
      if (arr.length === 0) return null;
      const index = Math.ceil((percentile / 100) * arr.length) - 1;
      return arr[Math.max(0, index)] ?? 0;
    };

    const sortedTimes = responseTimes
      .map((r) => r.response_time)
      .sort((a, b) => a - b);
    const percentiles = {
      p50: calculatePercentile(sortedTimes, 50),
      p75: calculatePercentile(sortedTimes, 75),
      p90: calculatePercentile(sortedTimes, 90),
      p95: calculatePercentile(sortedTimes, 95),
      p99: calculatePercentile(sortedTimes, 99),
    };

    // Response time distribution
    const totalWithResponseTime = responseTimes.length;
    const distributionRanges = [
      { min: 0, max: 50, label: "0-50ms" },
      { min: 50, max: 100, label: "50-100ms" },
      { min: 100, max: 200, label: "100-200ms" },
      { min: 200, max: 500, label: "200-500ms" },
      { min: 500, max: 1000, label: "500ms-1s" },
      { min: 1000, max: 2000, label: "1-2s" },
      { min: 2000, max: 5000, label: "2-5s" },
      { min: 5000, max: Infinity, label: "5s+" },
    ];

    const distribution = distributionRanges.map((range) => {
      const count = sortedTimes.filter(
        (time) => time >= range.min && time < range.max,
      ).length;
      return {
        range: range.label,
        count,
        percentage:
          totalWithResponseTime > 0 ? (count / totalWithResponseTime) * 100 : 0,
      };
    });

    // Slowest endpoints (grouped)
    const slowestEndpoints = requestsByEndpoint
      .filter((e) => e.averageResponseTime > 0)
      .sort((a, b) => b.averageResponseTime - a.averageResponseTime)
      .slice(0, 10);

    // Latency over time - hourly for 1 day, daily for longer periods
    let latencyOverTime: Array<{
      time: string;
      averageResponseTime: number;
      p95: number | null;
      count: number;
    }>;

    if (days === 1) {
      // Hourly latency data for last 24 hours (excluding stats)
      const latencyOverTimeRaw = this.db
        .query(
          `
           SELECT
             strftime('%Y-%m-%d %H:00', datetime(timestamp / 1000, 'unixepoch')) as time,
             AVG(response_time) as averageResponseTime,
             COUNT(*) as count
           FROM request_analytics
           WHERE timestamp > ? AND response_time IS NOT NULL AND endpoint != '/stats'
           GROUP BY strftime('%Y-%m-%d %H:00', datetime(timestamp / 1000, 'unixepoch'))
           ORDER BY time ASC
         `,
        )
        .all(cutoffTime) as Array<{
        time: string;
        averageResponseTime: number;
        count: number;
      }>;

      // Calculate P95 for each hour
      latencyOverTime = latencyOverTimeRaw.map((hourData) => {
        const hourStart = new Date(hourData.time).getTime();
        const hourEnd = hourStart + 60 * 60 * 1000; // 1 hour later

        const hourResponseTimes = this.db
          .query(
            `
             SELECT response_time
             FROM request_analytics
             WHERE timestamp >= ? AND timestamp < ? AND response_time IS NOT NULL AND endpoint != '/stats'
             ORDER BY response_time
           `,
          )
          .all(hourStart, hourEnd) as Array<{ response_time: number }>;

        const hourTimes = hourResponseTimes
          .map((r) => r.response_time)
          .sort((a, b) => a - b);
        const p95 = calculatePercentile(hourTimes, 95);

        return {
          time: hourData.time,
          averageResponseTime: hourData.averageResponseTime,
          p95,
          count: hourData.count,
        };
      });
    } else {
      // Daily latency data for longer periods (excluding stats)
      const latencyOverTimeRaw = this.db
        .query(
          `
           SELECT
             DATE(timestamp / 1000, 'unixepoch') as time,
             AVG(response_time) as averageResponseTime,
             COUNT(*) as count
           FROM request_analytics
           WHERE timestamp > ? AND response_time IS NOT NULL AND endpoint != '/stats'
           GROUP BY DATE(timestamp / 1000, 'unixepoch')
           ORDER BY time ASC
         `,
        )
        .all(cutoffTime) as Array<{
        time: string;
        averageResponseTime: number;
        count: number;
      }>;

      // Calculate P95 for each day
      latencyOverTime = latencyOverTimeRaw.map((dayData) => {
        const dayStart = new Date(dayData.time + " 00:00:00").getTime();
        const dayEnd = dayStart + 24 * 60 * 60 * 1000; // 1 day later

        const dayResponseTimes = this.db
          .query(
            `
             SELECT response_time
             FROM request_analytics
             WHERE timestamp >= ? AND timestamp < ? AND response_time IS NOT NULL AND endpoint != '/stats'
             ORDER BY response_time
           `,
          )
          .all(dayStart, dayEnd) as Array<{ response_time: number }>;

        const dayTimes = dayResponseTimes
          .map((r) => r.response_time)
          .sort((a, b) => a - b);
        const p95 = calculatePercentile(dayTimes, 95);

        return {
          time: dayData.time,
          averageResponseTime: dayData.averageResponseTime,
          p95,
          count: dayData.count,
        };
      });
    }

    // Performance Metrics
    const errorRequests = statusResults
      .filter((s) => s.status >= 400)
      .reduce((sum, s) => sum + s.count, 0);
    const errorRate =
      totalResult.count > 0 ? (errorRequests / totalResult.count) * 100 : 0;

    // Calculate throughput (requests per hour)
    const timeSpanHours = days * 24;
    const throughput = totalResult.count / timeSpanHours;

    // Calculate APDEX score (Application Performance Index)
    // Satisfied: <= 100ms, Tolerating: <= 400ms, Frustrated: > 400ms
    const satisfiedCount = sortedTimes.filter((t) => t <= 100).length;
    const toleratingCount = sortedTimes.filter(
      (t) => t > 100 && t <= 400,
    ).length;
    const apdex =
      totalWithResponseTime > 0
        ? (satisfiedCount + toleratingCount * 0.5) / totalWithResponseTime
        : 0;

    // Calculate cache hit rate (redirects vs data endpoints)
    const redirectRequests = requestsByEndpoint
      .filter((e) => e.endpoint.includes("Redirects"))
      .reduce((sum, e) => sum + e.count, 0);
    const dataRequests = requestsByEndpoint
      .filter((e) => e.endpoint.includes("Data"))
      .reduce((sum, e) => sum + e.count, 0);
    const cachehitRate =
      redirectRequests + dataRequests > 0
        ? (redirectRequests / (redirectRequests + dataRequests)) * 100
        : 0;

    // Simulate uptime (would need actual monitoring data)
    const uptime = Math.max(0, 100 - errorRate * 2); // Simple approximation

    // Peak traffic analysis (excluding stats)
    const peakHourData = this.db
      .query(
        `
         SELECT
           strftime('%H:00', datetime(timestamp / 1000, 'unixepoch')) as hour,
           COUNT(*) as count
         FROM request_analytics
         WHERE timestamp > ? AND endpoint != '/stats'
         GROUP BY strftime('%H:00', datetime(timestamp / 1000, 'unixepoch'))
         ORDER BY count DESC
         LIMIT 1
       `,
      )
      .get(cutoffTime) as { hour: string; count: number } | null;

    const peakDayData = this.db
      .query(
        `
         SELECT
           DATE(timestamp / 1000, 'unixepoch') as day,
           COUNT(*) as count
         FROM request_analytics
         WHERE timestamp > ? AND endpoint != '/stats'
         GROUP BY DATE(timestamp / 1000, 'unixepoch')
         ORDER BY count DESC
         LIMIT 1
       `,
      )
      .get(cutoffTime) as { day: string; count: number } | null;

    // Traffic Overview - detailed route breakdown over time
    let trafficOverview: Array<{
      time: string;
      routes: Record<string, number>;
      total: number;
    }>;

    if (days === 1) {
      // Hourly route breakdown for last 24 hours
      const trafficRaw = this.db
        .query(
          `
           SELECT
             strftime('%Y-%m-%d %H:00', datetime(timestamp / 1000, 'unixepoch')) as time,
             endpoint,
             COUNT(*) as count
           FROM request_analytics
           WHERE timestamp > ? AND endpoint != '/stats'
           GROUP BY strftime('%Y-%m-%d %H:00', datetime(timestamp / 1000, 'unixepoch')), endpoint
           ORDER BY time ASC
         `,
        )
        .all(cutoffTime) as Array<{
        time: string;
        endpoint: string;
        count: number;
      }>;

      // Group by time and create route breakdown
      const timeGroups: Record<string, Record<string, number>> = {};
      for (const row of trafficRaw) {
        if (!timeGroups[row.time]) {
          timeGroups[row.time] = {};
        }

        // Apply same grouping logic as endpoints
        let groupKey: string;
        const endpoint = row.endpoint;

        if (endpoint === "/" || endpoint === "/dashboard") {
          groupKey = "Dashboard";
        } else if (endpoint === "/health") {
          groupKey = "Health Check";
        } else if (endpoint === "/swagger" || endpoint.startsWith("/swagger")) {
          groupKey = "API Documentation";
        } else if (endpoint === "/emojis") {
          groupKey = "Emoji List";
        } else if (endpoint.match(/^\/emojis\/[^\/]+$/)) {
          groupKey = "Emoji Data";
        } else if (endpoint.match(/^\/emojis\/[^\/]+\/r$/)) {
          groupKey = "Emoji Redirects";
        } else if (endpoint.match(/^\/users\/[^\/]+$/)) {
          groupKey = "User Data";
        } else if (endpoint.match(/^\/users\/[^\/]+\/r$/)) {
          groupKey = "User Redirects";
        } else if (endpoint.match(/^\/users\/[^\/]+\/purge$/)) {
          groupKey = "Cache Management";
        } else if (endpoint === "/reset") {
          groupKey = "Cache Management";
        } else {
          groupKey = endpoint;
        }

        const group = timeGroups[row.time];

        if (group) {
          group[groupKey] = (group[groupKey] || 0) + row.count;
        }
      }

      trafficOverview = Object.entries(timeGroups)
        .map(([time, routes]) => ({
          time,
          routes,
          total: Object.values(routes).reduce((sum, count) => sum + count, 0),
        }))
        .sort((a, b) => a.time.localeCompare(b.time));
    } else if (days <= 7) {
      // 4-hour intervals for 7 days
      const trafficRaw = this.db
        .query(
          `
           SELECT
             strftime('%Y-%m-%d %H:00', datetime(timestamp / 1000, 'unixepoch')) as hour,
             endpoint,
             COUNT(*) as count
           FROM request_analytics
           WHERE timestamp > ? AND endpoint != '/stats'
           GROUP BY strftime('%Y-%m-%d %H:00', datetime(timestamp / 1000, 'unixepoch')), endpoint
           ORDER BY hour ASC
         `,
        )
        .all(cutoffTime) as Array<{
        hour: string;
        endpoint: string;
        count: number;
      }>;

      // Group into 4-hour intervals
      const intervalGroups: Record<string, Record<string, number>> = {};
      for (const row of trafficRaw) {
        const hourStr = row.hour?.split(" ")[1]?.split(":")[0];
        const hour = hourStr ? parseInt(hourStr) : 0;
        const intervalHour = Math.floor(hour / 4) * 4;
        const intervalTime =
          row.hour.split(" ")[0] +
          ` ${intervalHour.toString().padStart(2, "0")}:00`;

        if (!intervalGroups[intervalTime]) {
          intervalGroups[intervalTime] = {};
        }

        // Apply same grouping logic
        let groupKey: string;
        const endpoint = row.endpoint;

        if (endpoint === "/" || endpoint === "/dashboard") {
          groupKey = "Dashboard";
        } else if (endpoint === "/health") {
          groupKey = "Health Check";
        } else if (endpoint === "/swagger" || endpoint.startsWith("/swagger")) {
          groupKey = "API Documentation";
        } else if (endpoint === "/emojis") {
          groupKey = "Emoji List";
        } else if (endpoint.match(/^\/emojis\/[^\/]+$/)) {
          groupKey = "Emoji Data";
        } else if (endpoint.match(/^\/emojis\/[^\/]+\/r$/)) {
          groupKey = "Emoji Redirects";
        } else if (endpoint.match(/^\/users\/[^\/]+$/)) {
          groupKey = "User Data";
        } else if (endpoint.match(/^\/users\/[^\/]+\/r$/)) {
          groupKey = "User Redirects";
        } else if (endpoint.match(/^\/users\/[^\/]+\/purge$/)) {
          groupKey = "Cache Management";
        } else if (endpoint === "/reset") {
          groupKey = "Cache Management";
        } else {
          groupKey = endpoint;
        }

        intervalGroups[intervalTime][groupKey] =
          (intervalGroups[intervalTime][groupKey] || 0) + row.count;
      }

      trafficOverview = Object.entries(intervalGroups)
        .map(([time, routes]) => ({
          time,
          routes,
          total: Object.values(routes).reduce((sum, count) => sum + count, 0),
        }))
        .sort((a, b) => a.time.localeCompare(b.time));
    } else {
      // Daily breakdown for longer periods
      const trafficRaw = this.db
        .query(
          `
           SELECT
             DATE(timestamp / 1000, 'unixepoch') as time,
             endpoint,
             COUNT(*) as count
           FROM request_analytics
           WHERE timestamp > ? AND endpoint != '/stats'
           GROUP BY DATE(timestamp / 1000, 'unixepoch'), endpoint
           ORDER BY time ASC
         `,
        )
        .all(cutoffTime) as Array<{
        time: string;
        endpoint: string;
        count: number;
      }>;

      // Group by day
      const dayGroups: Record<string, Record<string, number>> = {};
      for (const row of trafficRaw) {
        if (!dayGroups[row.time]) {
          dayGroups[row.time] = {};
        }

        // Apply same grouping logic
        let groupKey: string;
        const endpoint = row.endpoint;

        if (endpoint === "/" || endpoint === "/dashboard") {
          groupKey = "Dashboard";
        } else if (endpoint === "/health") {
          groupKey = "Health Check";
        } else if (endpoint === "/swagger" || endpoint.startsWith("/swagger")) {
          groupKey = "API Documentation";
        } else if (endpoint === "/emojis") {
          groupKey = "Emoji List";
        } else if (endpoint.match(/^\/emojis\/[^\/]+$/)) {
          groupKey = "Emoji Data";
        } else if (endpoint.match(/^\/emojis\/[^\/]+\/r$/)) {
          groupKey = "Emoji Redirects";
        } else if (endpoint.match(/^\/users\/[^\/]+$/)) {
          groupKey = "User Data";
        } else if (endpoint.match(/^\/users\/[^\/]+\/r$/)) {
          groupKey = "User Redirects";
        } else if (endpoint.match(/^\/users\/[^\/]+\/purge$/)) {
          groupKey = "Cache Management";
        } else if (endpoint === "/reset") {
          groupKey = "Cache Management";
        } else {
          groupKey = endpoint;
        }
        const group = dayGroups[row.time];
        if (group) {
          group[groupKey] = (group[groupKey] || 0) + row.count;
        }
      }

      trafficOverview = Object.entries(dayGroups)
        .map(([time, routes]) => ({
          time,
          routes,
          total: Object.values(routes).reduce((sum, count) => sum + count, 0),
        }))
        .sort((a, b) => a.time.localeCompare(b.time));
    }

    return {
      totalRequests: totalResult.count,
      requestsByEndpoint: requestsByEndpoint,
      requestsByStatus: statusResults,
      requestsByDay: timeResults,
      averageResponseTime: avgResponseResult.avg,
      topUserAgents: topUserAgents,
      latencyAnalytics: {
        percentiles,
        distribution,
        slowestEndpoints,
        latencyOverTime,
      },
      performanceMetrics: {
        uptime,
        errorRate,
        throughput,
        apdex,
        cachehitRate,
      },
      peakTraffic: {
        peakHour: peakHourData?.hour || "N/A",
        peakRequests: peakHourData?.count || 0,
        peakDay: peakDayData?.day || "N/A",
        peakDayRequests: peakDayData?.count || 0,
      },
      dashboardMetrics: {
        statsRequests: statsResult.count,
        totalWithStats: totalResult.count + statsResult.count,
      },
      trafficOverview,
    };
  }
}

export { Cache as SlackCache };
