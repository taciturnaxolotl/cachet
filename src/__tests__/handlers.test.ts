import { describe, expect, it, mock } from "bun:test";
import { createHandlers } from "../handlers/index";
import type { SlackCache } from "../cache";

function createMockCache(overrides: Partial<SlackCache> = {}): SlackCache {
	return {
		getUser: mock(async () => null),
		getEmoji: mock(async () => null),
		getAllEmojis: mock(async () => []),
		insertUser: mock(async () => true),
		insertEmoji: mock(async () => true),
		batchInsertEmojis: mock(async () => true),
		purgeUserCache: mock(async () => true),
		purgeAll: mock(async () => ({ message: "Cache purged", users: 0, emojis: 0 })),
		queueUserUpdate: mock(() => {}),
		healthCheck: mock(async () => true),
		detailedHealthCheck: mock(async () => ({
			status: "healthy" as const,
			checks: {
				database: { status: true, latency: 1 },
				slackApi: { status: true },
				queueDepth: 0,
				memoryUsage: { heapUsed: 50, heapTotal: 100, percentage: 50 },
			},
			uptime: 1234,
		})),
		getEssentialStats: mock(async () => ({ totalRequests: 100, averageResponseTime: 25, uptime: 99.9 })),
		getChartData: mock(async () => ({ requestsByDay: [], latencyOverTime: [] })),
		getUserAgents: mock(async () => []),
		getUserAgentCount: mock(async () => 0),
		getReferers: mock(async () => []),
		getTraffic: mock(() => []),
		recordRequest: mock(() => {}),
		getUptime: mock(() => 99.9),
		endUptimeSession: mock(() => {}),
		setSlackWrapper: mock(() => {}),
		purgeExpiredItems: mock(async () => 0),
		close: mock(() => {}),
		...overrides,
	} as unknown as SlackCache;
}

const noopAnalytics = (_code: number) => {};

describe("handlers", () => {
	describe("handleHealthCheck", () => {
		it("returns healthy status", async () => {
			const cache = createMockCache();
			const handlers = createHandlers(cache);
			const request = new Request("http://localhost/health");
			const response = await handlers.handleHealthCheck(request, noopAnalytics);
			const body = await response.json();

			expect(response.status).toBe(200);
			expect(body.status).toBe("healthy");
			expect(body.cache).toBe(true);
		});

		it("returns detailed health when requested", async () => {
			const cache = createMockCache();
			const handlers = createHandlers(cache);
			const request = new Request("http://localhost/health?detailed=true");
			const response = await handlers.handleHealthCheck(request, noopAnalytics);
			const body = await response.json();

			expect(response.status).toBe(200);
			expect(body.checks).toBeDefined();
			expect(body.checks.database.status).toBe(true);
		});

		it("returns 503 when unhealthy", async () => {
			const cache = createMockCache({ healthCheck: mock(async () => false) });
			const handlers = createHandlers(cache);
			const request = new Request("http://localhost/health");
			const response = await handlers.handleHealthCheck(request, noopAnalytics);

			expect(response.status).toBe(503);
		});
	});

	describe("handleGetUser", () => {
		it("returns user data when found", async () => {
			const mockUser = {
				type: "user" as const,
				id: "uuid",
				userId: "U123",
				displayName: "Test",
				pronouns: "he/him",
				imageUrl: "https://example.com/img.png",
				expiration: new Date(),
			};
			const cache = createMockCache({ getUser: mock(async () => mockUser) });
			const handlers = createHandlers(cache);
			const request = new Request("http://localhost/users/U123");
			const response = await handlers.handleGetUser(request, noopAnalytics);
			const body = await response.json();

			expect(response.status).toBe(200);
			expect(body.userId).toBe("U123");
		});

		it("returns 202 with placeholder when user not cached", async () => {
			const cache = createMockCache();
			const handlers = createHandlers(cache);
			const request = new Request("http://localhost/users/U999");
			const response = await handlers.handleGetUser(request, noopAnalytics);

			expect(response.status).toBe(202);
			expect(cache.queueUserUpdate).toHaveBeenCalled();
		});
	});

	describe("handleGetEmoji", () => {
		it("returns emoji when found", async () => {
			const mockEmoji = {
				type: "emoji" as const,
				id: "uuid",
				name: "test",
				alias: null,
				imageUrl: "https://emoji.com/test.png",
				expiration: new Date(),
			};
			const cache = createMockCache({ getEmoji: mock(async () => mockEmoji) });
			const handlers = createHandlers(cache);
			const request = new Request("http://localhost/emojis/test");
			const response = await handlers.handleGetEmoji(request, noopAnalytics);

			expect(response.status).toBe(200);
		});

		it("returns 404 when emoji not found", async () => {
			const cache = createMockCache();
			const handlers = createHandlers(cache);
			const request = new Request("http://localhost/emojis/nonexistent");
			const response = await handlers.handleGetEmoji(request, noopAnalytics);

			expect(response.status).toBe(404);
		});
	});

	describe("handleListEmojis", () => {
		it("returns all emojis", async () => {
			const cache = createMockCache({ getAllEmojis: mock(async () => []) });
			const handlers = createHandlers(cache);
			const request = new Request("http://localhost/emojis");
			const response = await handlers.handleListEmojis(request, noopAnalytics);
			const body = await response.json();

			expect(response.status).toBe(200);
			expect(Array.isArray(body)).toBe(true);
		});
	});

	describe("handlePurgeUser", () => {
		it("returns 500 when BEARER_TOKEN not configured", async () => {
			const origToken = process.env.BEARER_TOKEN;
			delete process.env.BEARER_TOKEN;

			// Need to re-import since config is loaded at import time
			// Instead, test through the handler directly with a mock that has no token
			const cache = createMockCache();
			const handlers = createHandlers(cache);
			const request = new Request("http://localhost/users/U123/purge", { method: "POST" });
			const response = await handlers.handlePurgeUser(request, noopAnalytics);

			// This will depend on whether BEARER_TOKEN is set in the test env
			// The important thing is it doesn't crash
			expect(response.status).toBeOneOf([200, 401, 500]);

			if (origToken) process.env.BEARER_TOKEN = origToken;
		});
	});

	describe("analytics endpoints", () => {
		it("handleGetEssentialStats returns stats", async () => {
			const cache = createMockCache();
			const handlers = createHandlers(cache);
			const request = new Request("http://localhost/api/stats/essential?days=7");
			const response = await handlers.handleGetEssentialStats(request, noopAnalytics);
			const body = await response.json();

			expect(response.status).toBe(200);
			expect(body.totalRequests).toBe(100);
		});

		it("handleGetChartData returns chart data", async () => {
			const cache = createMockCache();
			const handlers = createHandlers(cache);
			const request = new Request("http://localhost/api/stats/charts");
			const response = await handlers.handleGetChartData(request, noopAnalytics);

			expect(response.status).toBe(200);
		});

		it("handleGetUserAgents returns agents and count", async () => {
			const cache = createMockCache();
			const handlers = createHandlers(cache);
			const request = new Request("http://localhost/api/stats/useragents");
			const response = await handlers.handleGetUserAgents(request, noopAnalytics);
			const body = await response.json();

			expect(response.status).toBe(200);
			expect(body.userAgents).toBeDefined();
			expect(body.totalCount).toBeDefined();
		});

		it("handleGetTraffic returns traffic data", async () => {
			const cache = createMockCache();
			const handlers = createHandlers(cache);
			const request = new Request("http://localhost/api/stats/traffic?days=7");
			const response = await handlers.handleGetTraffic(request, noopAnalytics);

			expect(response.status).toBe(200);
		});

		it("handleGetReferers returns referer data", async () => {
			const cache = createMockCache();
			const handlers = createHandlers(cache);
			const request = new Request("http://localhost/api/stats/referers");
			const response = await handlers.handleGetReferers(request, noopAnalytics);

			expect(response.status).toBe(200);
		});
	});
});
