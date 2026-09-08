/**
 * Dialect-specific SQL fragments.
 *
 * Every helper here exists because SQLite and Postgres genuinely disagree on
 * syntax -- anything expressible in both dialects is written inline at the call
 * site instead.
 */

import type { Dialect } from "./types";

/**
 * `?` / `?N` placeholders -> `$n`, leaving string literals, quoted identifiers
 * and comments untouched.
 *
 * Bare `?` are numbered left to right. A numbered `?N` maps to `$N`, which lets
 * a statement reference the same parameter more than once (the analytics
 * upserts add the same response time in both VALUES and DO UPDATE).
 */
export function toPostgresPlaceholders(sql: string): string {
	let out = "";
	let next = 1;
	let i = 0;

	while (i < sql.length) {
		const ch = sql[i] as string;

		// Skip over quoted runs so a `?` inside them is never rewritten.
		if (ch === "'" || ch === '"') {
			const quote = ch;
			let j = i + 1;
			while (j < sql.length) {
				if (sql[j] === quote) {
					// Doubled quote is an escaped quote, not the end of the run.
					if (sql[j + 1] === quote) {
						j += 2;
						continue;
					}
					break;
				}
				j++;
			}
			out += sql.slice(i, Math.min(j + 1, sql.length));
			i = j + 1;
			continue;
		}

		if (ch === "-" && sql[i + 1] === "-") {
			const end = sql.indexOf("\n", i);
			const stop = end === -1 ? sql.length : end;
			out += sql.slice(i, stop);
			i = stop;
			continue;
		}

		if (ch === "/" && sql[i + 1] === "*") {
			const end = sql.indexOf("*/", i + 2);
			const stop = end === -1 ? sql.length : end + 2;
			out += sql.slice(i, stop);
			i = stop;
			continue;
		}

		if (ch === "?") {
			let j = i + 1;
			while (
				j < sql.length &&
				(sql[j] as string) >= "0" &&
				(sql[j] as string) <= "9"
			) {
				j++;
			}
			if (j > i + 1) {
				out += `$${sql.slice(i + 1, j)}`;
				i = j;
			} else {
				out += `$${next++}`;
				i++;
			}
			continue;
		}

		out += ch;
		i++;
	}

	return out;
}

/**
 * Formats a unix-seconds column as `YYYY-MM-DD HH:MM:SS` in UTC.
 *
 * Both branches produce byte-identical strings, which matters because the
 * dashboard sorts and groups on this value as text.
 */
export function bucketToDateTime(dialect: Dialect, expr: string): string {
	return dialect === "sqlite"
		? `datetime(${expr}, 'unixepoch')`
		: `to_char(to_timestamp(${expr}) AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`;
}

/** Formats a unix-seconds column as the UTC hour, e.g. `15:00`. */
export function bucketToHour(dialect: Dialect, expr: string): string {
	return dialect === "sqlite"
		? `strftime('%H:00', datetime(${expr}, 'unixepoch'))`
		: `to_char(to_timestamp(${expr}) AT TIME ZONE 'UTC', 'HH24:00')`;
}

/** Formats a unix-seconds column as the UTC date, e.g. `2025-09-04`. */
export function bucketToDate(dialect: Dialect, expr: string): string {
	return dialect === "sqlite"
		? `DATE(${expr}, 'unixepoch')`
		: `to_char(to_timestamp(${expr}) AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
}

/**
 * Larger of two scalars. SQLite spells it `MAX(a, b)`; Postgres reserves MAX
 * for aggregates and spells the scalar form `GREATEST(a, b)`.
 */
export function greatest(dialect: Dialect, a: string, b: string): string {
	return dialect === "sqlite" ? `MAX(${a}, ${b})` : `GREATEST(${a}, ${b})`;
}

/**
 * Wraps an expression so it arrives in JS as a number.
 *
 * Postgres hands back `BIGINT`, `COUNT(*)` and `SUM(int)` as strings, which
 * would silently turn arithmetic into string concatenation and `new Date(...)`
 * into an invalid date. SQLite accepts the same CAST and ignores it.
 */
export function asNumber(expr: string): string {
	return `CAST(${expr} AS DOUBLE PRECISION)`;
}
