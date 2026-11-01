import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
	setSystemTime,
} from "bun:test";
import { schedule } from "node-cron";
import { CRON_SCHEDULES, CRON_TIMEZONE } from "../cache";

// node-cron 4.2.1 normalized dates with Date#setMilliseconds, which goes through
// the host's local zone. In the repeated fall-back hour that moved the date back
// an hour, the next match stopped advancing, and the runner's catch-up loop spun
// forever. Production runs on an America/New_York host, so test under that zone.
const HOST_TZ = "America/New_York";
const DST_DAYS = [
	{ name: "fall back", start: "2026-11-01T00:00:00Z" },
	{ name: "spring forward", start: "2027-03-14T00:00:00Z" },
];
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

describe("cron schedules across DST transitions", () => {
	let originalTz: string | undefined;

	beforeAll(() => {
		originalTz = process.env.TZ;
		process.env.TZ = HOST_TZ;
	});

	afterAll(() => {
		setSystemTime();
		if (originalTz === undefined) delete process.env.TZ;
		else process.env.TZ = originalTz;
	});

	for (const day of DST_DAYS) {
		for (const [job, pattern] of Object.entries(CRON_SCHEDULES)) {
			it(`${job} (${pattern}) always advances on ${day.name} day`, () => {
				const task = schedule(pattern, () => {}, { timezone: CRON_TIMEZONE });

				try {
					const start = Date.parse(day.start);
					for (let now = start; now < start + 2 * DAY_MS; now += MINUTE_MS) {
						setSystemTime(new Date(now + 30_000));
						const next = task.getNextRun()?.getTime() ?? Number.NaN;

						expect(next).toBeGreaterThan(now);
						expect(next).toBeLessThanOrEqual(now + DAY_MS + MINUTE_MS);
					}
				} finally {
					task.stop();
				}
			});
		}
	}
});
