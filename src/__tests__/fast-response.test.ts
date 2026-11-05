import { describe, expect, it } from "bun:test";
import { addCorsHeaders, CORS_HEADERS } from "../lib/cors";
import { cachedJson, corsRedirect } from "../lib/fast-response";

function lowerHeaders(record: Record<string, string>): [string, string][] {
	return Object.entries(record)
		.map(([k, v]): [string, string] => [k.toLowerCase(), v])
		.sort();
}

describe("fast responses", () => {
	const value = {
		type: "user",
		id: "U1",
		displayName: 'Käthe \u2028 "quoted"',
		expiration: new Date(1_700_000_000_000),
	};

	it("cachedJson matches Response.json plus CORS, byte for byte", async () => {
		const reference = addCorsHeaders(Response.json(value));
		const fast = addCorsHeaders(cachedJson(value));
		expect(fast.status).toBe(reference.status);
		expect([...fast.headers].sort()).toEqual([...reference.headers].sort());
		expect(await fast.text()).toBe(await reference.text());
	});

	it("cachedJson reuses the body for repeated calls on the same object", async () => {
		const a = await cachedJson(value).text();
		const b = await cachedJson(value).text();
		expect(b).toBe(a);
	});

	it("corsRedirect matches a plain redirect plus CORS", () => {
		const reference = addCorsHeaders(
			new Response(null, { status: 302, headers: { Location: "https://x/y" } }),
		);
		const fast = corsRedirect(302, "https://x/y");
		expect(fast.status).toBe(302);
		expect([...fast.headers].sort()).toEqual([...reference.headers].sort());
		const expected: [string, string][] = [
			["location", "https://x/y"],
			...lowerHeaders(CORS_HEADERS),
		];
		expect([...addCorsHeaders(fast).headers].sort()).toEqual(expected.sort());
	});
});
