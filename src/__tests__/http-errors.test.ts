import { describe, expect, it, mock } from "bun:test";
import type { SlackCache } from "../cache";
import { createAnalyticsWrapper } from "../lib/analytics-wrapper";
import {
	createFallbackHandler,
	internalErrorResponse,
	jsonError,
} from "../lib/http-errors";

type ErrorBody = {
	error: { code: string; message: string; hint: string };
};

async function body(response: Response): Promise<ErrorBody> {
	return (await response.json()) as ErrorBody;
}

describe("structured HTTP errors", () => {
	it("returns a JSON error envelope with a resolution hint", async () => {
		const response = jsonError(
			404,
			"THING_NOT_FOUND",
			"Missing.",
			"Try again.",
		);

		expect(response.status).toBe(404);
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(await body(response)).toEqual({
			error: {
				code: "THING_NOT_FOUND",
				message: "Missing.",
				hint: "Try again.",
			},
		});
	});

	it("returns a structured 404 for an unknown route", async () => {
		const fallback = createFallbackHandler({ "/health": { GET: () => {} } });
		const response = fallback(new Request("http://localhost/missing"));

		expect(response.status).toBe(404);
		expect((await body(response)).error.code).toBe("ROUTE_NOT_FOUND");
	});

	it("returns a structured 405 and Allow header for a known route", async () => {
		const fallback = createFallbackHandler({
			"/users/:id": { GET: () => {} },
			"/users/:id/purge": { POST: () => {} },
		});
		const response = fallback(
			new Request("http://localhost/users/U123", { method: "POST" }),
		);

		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("GET");
		expect((await body(response)).error.code).toBe("METHOD_NOT_ALLOWED");
	});

	it("prefers an exact static route over an earlier dynamic pattern", async () => {
		const fallback = createFallbackHandler({
			"/emojis/:name": { GET: () => {} },
			"/emojis/purge": { POST: () => {} },
		});
		const response = fallback(
			new Request("http://localhost/emojis/purge", { method: "DELETE" }),
		);

		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("POST");
		expect((await body(response)).error.code).toBe("METHOD_NOT_ALLOWED");
	});

	it("returns a safe structured 500 without leaking exception details", async () => {
		const response = internalErrorResponse();
		const error = (await body(response)).error;

		expect(response.status).toBe(500);
		expect(error.code).toBe("INTERNAL_ERROR");
		expect(error.message).not.toContain("stack");
	});

	it("converts thrown API handler errors into structured JSON", async () => {
		const recordRequest = mock(() => {});
		const withAnalytics = createAnalyticsWrapper({
			recordRequest,
		} as unknown as SlackCache);
		const handler = withAnalytics("/example", "GET", async () => {
			throw new Error("database password must not leak");
		});
		const originalConsoleError = console.error;
		console.error = mock(() => {});
		try {
			const response = await handler(new Request("http://localhost/example"));
			const error = (await body(response)).error;

			expect(response.status).toBe(500);
			expect(error.code).toBe("INTERNAL_ERROR");
			expect(JSON.stringify(error)).not.toContain("password");
			expect(recordRequest).toHaveBeenCalled();
		} finally {
			console.error = originalConsoleError;
		}
	});
});
