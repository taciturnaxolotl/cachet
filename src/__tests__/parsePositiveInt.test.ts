import { describe, expect, it } from "bun:test";
import { parsePositiveInt as parseFromHandlers } from "../handlers/index";
import { parsePositiveInt as parseFromConfig } from "../config";

describe("parsePositiveInt (handlers)", () => {
	it("returns fallback for null", () => {
		expect(parseFromHandlers(null, 7)).toBe(7);
	});

	it("parses valid positive integers", () => {
		expect(parseFromHandlers("42", 7)).toBe(42);
		expect(parseFromHandlers("1", 7)).toBe(1);
	});

	it("returns fallback for non-positive numbers", () => {
		expect(parseFromHandlers("0", 7)).toBe(7);
		expect(parseFromHandlers("-5", 7)).toBe(7);
	});

	it("returns fallback for non-numeric strings", () => {
		expect(parseFromHandlers("abc", 7)).toBe(7);
		expect(parseFromHandlers("", 7)).toBe(7);
	});

	it("returns fallback for NaN-producing values", () => {
		expect(parseFromHandlers("3.14", 7)).toBe(3); // parseInt truncates
	});
});

describe("parsePositiveInt (config)", () => {
	it("returns fallback for undefined", () => {
		expect(parseFromConfig(undefined, 3)).toBe(3);
	});

	it("parses valid positive integers", () => {
		expect(parseFromConfig("10", 3)).toBe(10);
	});

	it("returns fallback for invalid values", () => {
		expect(parseFromConfig("0", 3)).toBe(3);
		expect(parseFromConfig("-1", 3)).toBe(3);
		expect(parseFromConfig("abc", 3)).toBe(3);
	});
});
