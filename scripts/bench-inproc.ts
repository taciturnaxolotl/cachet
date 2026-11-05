/**
 * In-process handler benchmark: calls route handlers directly, no socket.
 * Isolates the code we own from Bun's HTTP stack.
 *
 * Usage: bun scripts/bench-inproc.ts [path-to-db]
 *   N=200000 to change iterations per case, ONLY=<substring> to filter cases
 */

import { Database } from "bun:sqlite";
import { copyFileSync, unlinkSync } from "node:fs";
import { SlackCache } from "../src/cache";
import { createApiRoutes } from "../src/routes/api-routes";
import type { SlackWrapper } from "../src/slackWrapper";
import type { RouteDefinition } from "../src/types/routes";

const SRC_DB = process.argv[2] ?? "./data/cachet.db";
const DB = "/tmp/cachet-bench.db";
const SAMPLE = 200;
const SEEDED_EMOJIS = 3000;

for (const suffix of ["", "-wal", "-shm"]) {
	try {
		unlinkSync(DB + suffix);
	} catch {}
}
copyFileSync(SRC_DB, DB);

const far = Date.now() + 30 * 86400_000;
const userIds: string[] = [];
const emojiNames: string[] = [];
{
	const db = new Database(DB);
	for (const r of db
		.query(
			"SELECT userId FROM users WHERE imageUrl != '' ORDER BY RANDOM() LIMIT ?",
		)
		.all(SAMPLE) as { userId: string }[]) {
		userIds.push(r.userId);
	}
	const bump = db.prepare("UPDATE users SET expiration = ? WHERE userId = ?");
	db.transaction(() => {
		for (const id of userIds) bump.run(far, id);
	})();

	// Seed custom emojis so the list and hit paths have realistic data
	db.run("DELETE FROM emojis");
	const ins = db.prepare(
		"INSERT INTO emojis (id, name, alias, imageUrl, expiration) VALUES (?, ?, NULL, ?, ?)",
	);
	db.transaction(() => {
		for (let i = 0; i < SEEDED_EMOJIS; i++) {
			const name = `bench-emoji-${i}`;
			ins.run(
				`emoji-${name}`,
				name,
				`https://emoji.slack-edge.com/T0266FRGM/${name}/0123456789abcdef.png`,
				far,
			);
		}
	})();
	for (let i = 0; i < SAMPLE; i++) emojiNames.push(`bench-emoji-${i * 7}`);
	db.close();
}
if (userIds.length < SAMPLE) throw new Error(`only ${userIds.length} users`);

const cache = new SlackCache(DB, 24);
const routes = createApiRoutes(cache, {} as SlackWrapper) as unknown as Record<
	string,
	RouteDefinition
>;

type Handler = (r: Request) => Promise<Response>;
function handler(path: string): Handler {
	const route = routes[path] as
		| Record<string, { handler: Handler }>
		| undefined;
	const get = route?.GET;
	if (!get) throw new Error(`no GET route for ${path}`);
	return get.handler;
}

const BASE = "http://localhost:3000";
const init = {
	headers: {
		"user-agent":
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120",
		referer: "https://hackclub.com/x",
	},
};
const NATIVE = ["thumbsup", "heart", "fire", "eyes", "tada", "100", "joy"];

interface Case {
	name: string;
	path: string;
	urls: string[];
	status: number;
}
const cases: Case[] = [
	{
		name: "GET /users/:id",
		path: "/users/:id",
		status: 200,
		urls: userIds.map((u) => `/users/${u}`),
	},
	{
		name: "GET /users/:id/r",
		path: "/users/:id/r",
		status: 302,
		urls: userIds.map((u) => `/users/${u}/r`),
	},
	{
		name: "GET /emojis/:name",
		path: "/emojis/:name",
		status: 200,
		urls: emojiNames.map((e) => `/emojis/${e}`),
	},
	{
		name: "GET /emojis/:name/r",
		path: "/emojis/:name/r",
		status: 302,
		urls: emojiNames.map((e) => `/emojis/${e}/r`),
	},
	{
		name: "GET /emojis/:native/r",
		path: "/emojis/:name/r",
		status: 302,
		urls: NATIVE.map((e) => `/emojis/${e}/r`),
	},
	{ name: "GET /health", path: "/health", status: 200, urls: ["/health"] },
	{
		name: "GET /api/stats/essential",
		path: "/api/stats/essential",
		status: 200,
		urls: ["/api/stats/essential"],
	},
	{
		name: "GET /api/stats",
		path: "/api/stats",
		status: 200,
		urls: ["/api/stats"],
	},
	{
		name: "GET /emojis (list)",
		path: "/emojis",
		status: 200,
		urls: ["/emojis"],
	},
];

const N = Number(process.env.N ?? 200_000);
const only = process.env.ONLY;

for (const c of cases) {
	if (only && !c.name.includes(only)) continue;
	const fn = handler(c.path);
	// GET requests carry no body, so a Request can be reused across calls
	const reqs = c.urls.map((u) => new Request(BASE + u, init));
	const n = c.path === "/emojis" ? Math.ceil(N / 200) : N;

	for (const req of reqs) {
		const res = await fn(req);
		if (res.status !== c.status) {
			throw new Error(
				`${c.name}: ${req.url} gave ${res.status}, want ${c.status}`,
			);
		}
		await res.arrayBuffer();
	}
	for (let i = 0; i < Math.min(n, 20_000); i++) {
		await (await fn(reqs[i % reqs.length] as Request)).arrayBuffer();
	}
	cache.flushAnalytics();

	const t0 = Bun.nanoseconds();
	for (let i = 0; i < n; i++) {
		await (await fn(reqs[i % reqs.length] as Request)).arrayBuffer();
	}
	cache.flushAnalytics();
	const ns = (Bun.nanoseconds() - t0) / n;
	console.log(
		`${c.name.padEnd(24)} ${ns.toFixed(0).padStart(9)} ns/op ${(1e9 / ns / 1000).toFixed(1).padStart(8)}k op/s`,
	);
}

cache.close();
process.exit(0);
