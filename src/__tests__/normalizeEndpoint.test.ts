import { describe, expect, it } from "bun:test";
import { normalizeEndpoint } from "../migrations/normalizeEndpoint";

describe("normalizeEndpoint", () => {
	it("normalizes user data endpoints", () => {
		expect(normalizeEndpoint("/users/U062UG485EE")).toBe("/users/USER_ID");
		expect(normalizeEndpoint("/users/ABC123")).toBe("/users/USER_ID");
	});

	it("normalizes user redirect endpoints", () => {
		expect(normalizeEndpoint("/users/U062UG485EE/r")).toBe("/users/USER_ID/r");
	});

	it("normalizes user purge to /reset", () => {
		expect(normalizeEndpoint("/users/U062UG485EE/purge")).toBe("/reset");
		expect(normalizeEndpoint("/reset")).toBe("/reset");
	});

	it("normalizes emoji data endpoints", () => {
		expect(normalizeEndpoint("/emojis/hackshark")).toBe("/emojis/EMOJI_NAME");
	});

	it("normalizes emoji redirect endpoints", () => {
		expect(normalizeEndpoint("/emojis/hackshark/r")).toBe("/emojis/EMOJI_NAME/r");
	});

	it("normalizes static routes", () => {
		expect(normalizeEndpoint("/")).toBe("/");
		expect(normalizeEndpoint("/health")).toBe("/health");
		expect(normalizeEndpoint("/dashboard")).toBe("/dashboard");
		expect(normalizeEndpoint("/stats")).toBe("/stats");
	});

	it("normalizes swagger routes", () => {
		expect(normalizeEndpoint("/swagger")).toBe("/swagger");
		expect(normalizeEndpoint("/swagger.json")).toBe("/swagger");
	});

	it("returns /other for unknown paths", () => {
		expect(normalizeEndpoint("/unknown")).toBe("/other");
		expect(normalizeEndpoint("/foo/bar/baz")).toBe("/other");
	});

	it("extracts path from full URLs", () => {
		expect(normalizeEndpoint("http://localhost:3000/users/U123")).toBe("/users/USER_ID");
		expect(normalizeEndpoint("https://example.com/emojis/test/r")).toBe("/emojis/EMOJI_NAME/r");
	});

	it("handles non-standard user/emoji formats via includes fallback", () => {
		expect(normalizeEndpoint("/api/users/something/r")).toBe("/users/USER_ID/r");
		expect(normalizeEndpoint("/api/users/something")).toBe("/users/USER_ID");
		expect(normalizeEndpoint("/api/emojis/something/r")).toBe("/emojis/EMOJI_NAME/r");
		expect(normalizeEndpoint("/api/emojis/something")).toBe("/emojis/EMOJI_NAME");
	});
});
