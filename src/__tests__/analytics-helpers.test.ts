import { describe, expect, it } from "bun:test";
import { selectBucketTable, groupEndpoint } from "../lib/analytics-queries";

describe("selectBucketTable", () => {
	it("returns 10min table for <= 1 day", () => {
		expect(selectBucketTable(1)).toEqual({ table: "traffic_10min", bucketSize: 600 });
		expect(selectBucketTable(0.5)).toEqual({ table: "traffic_10min", bucketSize: 600 });
	});

	it("returns hourly table for 2-30 days", () => {
		expect(selectBucketTable(7)).toEqual({ table: "traffic_hourly", bucketSize: 3600 });
		expect(selectBucketTable(30)).toEqual({ table: "traffic_hourly", bucketSize: 3600 });
	});

	it("returns daily table for > 30 days", () => {
		expect(selectBucketTable(31)).toEqual({ table: "traffic_daily", bucketSize: 86400 });
		expect(selectBucketTable(90)).toEqual({ table: "traffic_daily", bucketSize: 86400 });
	});
});

describe("groupEndpoint", () => {
	it("groups dashboard routes", () => {
		expect(groupEndpoint("/")).toBe("Dashboard");
		expect(groupEndpoint("/dashboard")).toBe("Dashboard");
	});

	it("groups health check", () => {
		expect(groupEndpoint("/health")).toBe("Health Check");
	});

	it("groups API documentation", () => {
		expect(groupEndpoint("/swagger")).toBe("API Documentation");
		expect(groupEndpoint("/swagger.json")).toBe("API Documentation");
	});

	it("groups emoji endpoints", () => {
		expect(groupEndpoint("/emojis")).toBe("Emoji List");
		expect(groupEndpoint("/emojis/hackshark")).toBe("Emoji Data");
		expect(groupEndpoint("/emojis/EMOJI_NAME")).toBe("Emoji Data");
		expect(groupEndpoint("/emojis/hackshark/r")).toBe("Emoji Redirects");
		expect(groupEndpoint("/emojis/EMOJI_NAME/r")).toBe("Emoji Redirects");
	});

	it("groups user endpoints", () => {
		expect(groupEndpoint("/users/U062UG485EE")).toBe("User Data");
		expect(groupEndpoint("/users/USER_ID")).toBe("User Data");
		expect(groupEndpoint("/users/U062UG485EE/r")).toBe("User Redirects");
		expect(groupEndpoint("/users/USER_ID/r")).toBe("User Redirects");
	});

	it("groups cache management", () => {
		expect(groupEndpoint("/users/U062UG485EE/purge")).toBe("Cache Management");
		expect(groupEndpoint("/reset")).toBe("Cache Management");
	});

	it("returns Other for unknown endpoints", () => {
		expect(groupEndpoint("/unknown")).toBe("Other");
	});
});
