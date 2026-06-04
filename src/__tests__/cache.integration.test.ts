import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { SlackCache } from "../cache";
import { unlinkSync } from "node:fs";

const TEST_DB_PATH = "/tmp/cachet-test.db";

describe("SlackCache integration", () => {
	let cache: SlackCache;

	beforeAll(() => {
		try {
			unlinkSync(TEST_DB_PATH);
		} catch {}
		cache = new SlackCache(TEST_DB_PATH, 24);
	});

	afterAll(() => {
		cache.close();
		try {
			unlinkSync(TEST_DB_PATH);
		} catch {}
	});

	describe("user CRUD", () => {
		it("inserts and retrieves a user", async () => {
			const ok = await cache.insertUser(
				"U123",
				"Test User",
				"he/him",
				"https://example.com/avatar.png",
			);
			expect(ok).toBe(true);

			const user = await cache.getUser("U123");
			expect(user).not.toBeNull();
			expect(user!.userId).toBe("U123");
			expect(user!.displayName).toBe("Test User");
			expect(user!.pronouns).toBe("he/him");
			expect(user!.imageUrl).toBe("https://example.com/avatar.png");
			expect(user!.type).toBe("user");
		});

		it("normalizes userId to uppercase", async () => {
			await cache.insertUser(
				"u456",
				"Lower",
				"",
				"https://example.com/lower.png",
			);
			const user = await cache.getUser("u456");
			expect(user).not.toBeNull();
			expect(user!.userId).toBe("U456");
		});

		it("updates imageUrl on conflict (displayName/pronouns preserved from first insert)", async () => {
			await cache.insertUser("U789", "Old Name", "", "https://old.com/img.png");
			await cache.insertUser(
				"U789",
				"New Name",
				"she/her",
				"https://new.com/img.png",
			);

			const user = await cache.getUser("U789");
			// ON CONFLICT only updates imageUrl and expiration, not displayName/pronouns
			expect(user!.displayName).toBe("Old Name");
			expect(user!.imageUrl).toBe("https://new.com/img.png");
		});

		it("returns null for non-existent user", async () => {
			const user = await cache.getUser("NONEXISTENT");
			expect(user).toBeNull();
		});

		it("purges a specific user", async () => {
			await cache.insertUser(
				"UPURGE",
				"Purge Me",
				"",
				"https://example.com/p.png",
			);
			const purged = await cache.purgeUserCache("UPURGE");
			expect(purged).toBe(true);

			const user = await cache.getUser("UPURGE");
			expect(user).toBeNull();
		});
	});

	describe("emoji CRUD", () => {
		it("inserts and retrieves an emoji", async () => {
			const ok = await cache.insertEmoji(
				"hackshark",
				null,
				"https://emoji.com/hackshark.png",
			);
			expect(ok).toBe(true);

			const emoji = await cache.getEmoji("hackshark");
			expect(emoji).not.toBeNull();
			expect(emoji!.name).toBe("hackshark");
			expect(emoji!.alias).toBeNull();
			expect(emoji!.type).toBe("emoji");
		});

		it("normalizes emoji name to lowercase", async () => {
			await cache.insertEmoji("UpperCase", null, "https://emoji.com/upper.png");
			const emoji = await cache.getEmoji("UPPERCASE");
			expect(emoji).not.toBeNull();
			expect(emoji!.name).toBe("uppercase");
		});

		it("handles emoji aliases", async () => {
			await cache.insertEmoji(
				"alias_emoji",
				"original",
				"https://emoji.com/alias.png",
			);
			const emoji = await cache.getEmoji("alias_emoji");
			expect(emoji!.alias).toBe("original");
		});

		it("batch inserts emojis", async () => {
			const emojis = [
				{ name: "batch1", imageUrl: "https://emoji.com/1.png", alias: null },
				{ name: "batch2", imageUrl: "https://emoji.com/2.png", alias: "b1" },
				{ name: "batch3", imageUrl: "https://emoji.com/3.png", alias: null },
			];
			const ok = await cache.batchInsertEmojis(emojis);
			expect(ok).toBe(true);

			const all = await cache.getAllEmojis();
			const batchNames = all
				.filter((e) => e.name.startsWith("batch"))
				.map((e) => e.name);
			expect(batchNames).toContain("batch1");
			expect(batchNames).toContain("batch2");
			expect(batchNames).toContain("batch3");
		});

		it("returns null for non-existent emoji", async () => {
			const emoji = await cache.getEmoji("nonexistent");
			expect(emoji).toBeNull();
		});
	});

	describe("purgeAll", () => {
		it("purges all users and emojis", async () => {
			await cache.insertUser("UALL1", "User1", "", "https://example.com/1.png");
			await cache.insertEmoji("eall1", null, "https://emoji.com/1.png");

			const result = await cache.purgeAll();
			expect(result.message).toBe("Cache purged");
			expect(result.users).toBeGreaterThanOrEqual(1);
			expect(result.emojis).toBeGreaterThanOrEqual(1);

			const user = await cache.getUser("UALL1");
			expect(user).toBeNull();
		});
	});

	describe("health checks", () => {
		it("reports healthy when database is accessible", async () => {
			const healthy = await cache.healthCheck();
			expect(healthy).toBe(true);
		});

		it("returns detailed health check", async () => {
			const health = await cache.detailedHealthCheck();
			expect(health.status).toBeOneOf(["healthy", "degraded"]);
			expect(health.checks.database.status).toBe(true);
			expect(health.checks.database.latency).toBeGreaterThanOrEqual(0);
			expect(health.checks.memoryUsage.heapUsed).toBeGreaterThan(0);
			expect(health.uptime).toBeGreaterThan(0);
		});
	});

	describe("uptime tracking", () => {
		it("reports uptime percentage", () => {
			const uptime = cache.getUptime();
			expect(uptime).toBeGreaterThanOrEqual(0);
			expect(uptime).toBeLessThanOrEqual(100);
		});
	});

	describe("analytics recording", () => {
		it("records requests without throwing", () => {
			expect(() => {
				cache.recordRequest(
					"/test",
					200,
					"TestAgent/1.0",
					15.5,
					"https://example.com",
				);
			}).not.toThrow();
		});

		it("records multiple requests and retrieves stats", async () => {
			for (let i = 0; i < 5; i++) {
				cache.recordRequest("/test-stats", 200, "TestAgent/1.0", 10 + i);
			}

			const stats = await cache.getEssentialStats(1);
			expect(stats.totalRequests).toBeGreaterThan(0);
			expect(stats.uptime).toBeGreaterThanOrEqual(0);
		});

		it("retrieves traffic data", () => {
			cache.recordRequest("/traffic-test", 200, "TestAgent", 5.0);
			const traffic = cache.getTraffic({ days: 1 });
			expect(Array.isArray(traffic)).toBe(true);
		});

		it("retrieves user agents", async () => {
			cache.recordRequest("/ua-test", 200, "UniqueAgent/99.0", 1.0);
			const agents = await cache.getUserAgents();
			expect(Array.isArray(agents)).toBe(true);
		});

		it("retrieves referers", async () => {
			cache.recordRequest(
				"/ref-test",
				200,
				"Agent",
				1.0,
				"https://referrer.example.com/page",
			);
			const referers = await cache.getReferers();
			expect(Array.isArray(referers)).toBe(true);
		});
	});

	describe("queue management", () => {
		it("queues user updates without error", () => {
			expect(() => cache.queueUserUpdate("UQUEUE")).not.toThrow();
		});
	});
});
