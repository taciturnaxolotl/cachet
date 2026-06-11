/**
 * Benchmark script for cachet server
 * Auto-selects random real users/emojis from the prod db
 */

import { Database } from "bun:sqlite";

const BASE = "http://localhost:3000";
const DB_PATH = process.env.DATABASE_PATH ?? "./data/cachet.db";
const SAMPLE_SIZE = 10;

interface BenchResult {
	name: string;
	requests: number;
	totalMs: number;
	avgMs: number;
	p50Ms: number;
	p95Ms: number;
	p99Ms: number;
	rps: number;
	errors: number;
}

function sampleFromDb(): { userIds: string[]; emojiNames: string[] } {
	const db = new Database(DB_PATH, { readonly: true });
	const now = Date.now();

	const userIds = (db
		.query(
			"SELECT userId FROM users WHERE imageUrl IS NOT NULL AND imageUrl != '' AND expiration > ? ORDER BY RANDOM() LIMIT ?",
		)
		.all(now, SAMPLE_SIZE) as Array<{ userId: string }>)
		.map((r) => r.userId);

	const emojiNames = (db
		.query(
			"SELECT name FROM emojis WHERE imageUrl IS NOT NULL AND imageUrl != '' AND expiration > ? AND length(name) BETWEEN 2 AND 30 ORDER BY RANDOM() LIMIT ?",
		)
		.all(now, SAMPLE_SIZE) as Array<{ name: string }>)
		.map((r) => r.name);

	db.close();

	if (userIds.length === 0) throw new Error("No valid users found in db");
	if (emojiNames.length === 0) throw new Error("No valid emojis found in db");

	return { userIds, emojiNames };
}

async function benchmark(
	name: string,
	urlFn: (i: number) => string,
	durationMs: number,
	concurrency: number,
): Promise<BenchResult> {
	const latencies: number[] = [];
	let errors = 0;
	let completed = 0;

	const startTime = performance.now();
	const endTime = startTime + durationMs;

	async function worker() {
		let i = 0;
		while (performance.now() < endTime) {
			const url = urlFn(i++);
			const t0 = performance.now();
			try {
				const res = await fetch(url, { redirect: "manual" });
				await res.arrayBuffer();
				latencies.push(performance.now() - t0);
			} catch {
				errors++;
				latencies.push(performance.now() - t0);
			}
			completed++;
		}
	}

	const workers = Array.from({ length: concurrency }, () => worker());
	await Promise.all(workers);

	const totalMs = performance.now() - startTime;
	latencies.sort((a, b) => a - b);

	const percentile = (p: number) => {
		const idx = Math.floor(latencies.length * p);
		return latencies[Math.min(idx, latencies.length - 1)] ?? 0;
	};

	return {
		name,
		requests: completed,
		totalMs: Math.round(totalMs),
		avgMs: Number((latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(3)),
		p50Ms: Number(percentile(0.5).toFixed(3)),
		p95Ms: Number(percentile(0.95).toFixed(3)),
		p99Ms: Number(percentile(0.99).toFixed(3)),
		rps: Math.round(completed / (totalMs / 1000)),
		errors,
	};
}

function printResult(r: BenchResult) {
	console.log(`\n--- ${r.name} ---`);
	console.log(`  Requests: ${r.requests} (${r.rps} req/s)`);
	console.log(`  Avg: ${r.avgMs}ms | p50: ${r.p50Ms}ms | p95: ${r.p95Ms}ms | p99: ${r.p99Ms}ms`);
	console.log(`  Errors: ${r.errors}`);
}

async function main() {
	const DURATION = 5000;
	const CONCURRENCY = 10;

	console.log(`Sampling ${SAMPLE_SIZE} random users/emojis from ${DB_PATH}...`);
	const { userIds, emojiNames } = sampleFromDb();
	console.log(`Users: ${userIds.join(", ")}`);
	console.log(`Emojis: ${emojiNames.join(", ")}`);
	console.log(`\nBenchmarking ${BASE} (${DURATION}ms per test, ${CONCURRENCY} concurrent)\n`);

	console.log("Warming up...");
	for (let i = 0; i < 100; i++) {
		await fetch(`${BASE}/health`).then((r) => r.arrayBuffer());
		await fetch(`${BASE}/users/${userIds[i % userIds.length]}`).then((r) => r.arrayBuffer());
		await fetch(`${BASE}/emojis/${emojiNames[i % emojiNames.length]}`).then((r) => r.arrayBuffer());
		await fetch(`${BASE}/users/${userIds[i % userIds.length]}/r`).then((r) => r.arrayBuffer());
		await fetch(`${BASE}/emojis/${emojiNames[i % emojiNames.length]}/r`).then((r) => r.arrayBuffer());
	}
	console.log("Warmup done.\n");

	const results: BenchResult[] = [];

	results.push(await benchmark("GET /health", () => `${BASE}/health`, DURATION, CONCURRENCY));

	results.push(await benchmark("GET /users/:id (data)", (i) => `${BASE}/users/${userIds[i % userIds.length]}`, DURATION, CONCURRENCY));

	results.push(await benchmark("GET /users/:id/r (redirect)", (i) => `${BASE}/users/${userIds[i % userIds.length]}/r`, DURATION, CONCURRENCY));

	results.push(await benchmark("GET /emojis/:name (data)", (i) => `${BASE}/emojis/${emojiNames[i % emojiNames.length]}`, DURATION, CONCURRENCY));

	results.push(await benchmark("GET /emojis/:name/r (redirect)", (i) => `${BASE}/emojis/${emojiNames[i % emojiNames.length]}/r`, DURATION, CONCURRENCY));

	results.push(await benchmark("GET /api/stats (full)", () => `${BASE}/api/stats`, DURATION, CONCURRENCY));

	results.push(await benchmark("GET /api/stats/essential", () => `${BASE}/api/stats/essential`, DURATION, CONCURRENCY));

	results.push(await benchmark("Mixed workload", (i) => {
		const mod = i % 10;
		if (mod < 3) return `${BASE}/users/${userIds[i % userIds.length]}/r`;
		if (mod < 5) return `${BASE}/emojis/${emojiNames[i % emojiNames.length]}/r`;
		if (mod < 7) return `${BASE}/users/${userIds[i % userIds.length]}`;
		if (mod < 9) return `${BASE}/emojis/${emojiNames[i % emojiNames.length]}`;
		return `${BASE}/health`;
	}, DURATION, CONCURRENCY));

	console.log("\n========== RESULTS ==========");
	for (const r of results) {
		printResult(r);
	}

	console.log("\n========== SUMMARY ==========");
	console.log("Endpoint".padEnd(35), "RPS".padStart(8), "Avg ms".padStart(8), "p50 ms".padStart(8), "p95 ms".padStart(8), "p99 ms".padStart(8));
	console.log("-".repeat(85));
	for (const r of results) {
		console.log(
			r.name.padEnd(35),
			String(r.rps).padStart(8),
			String(r.avgMs).padStart(8),
			String(r.p50Ms).padStart(8),
			String(r.p95Ms).padStart(8),
			String(r.p99Ms).padStart(8),
		);
	}
}

main().catch(console.error);
