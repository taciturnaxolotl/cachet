import { CORS_HEADERS } from "./cors";

const JSON_HEADERS = {
	"content-type": "application/json;charset=utf-8",
	...CORS_HEADERS,
};

/** Bodies keyed by identity; only pass frozen values from the cache layer. */
const bodies = new WeakMap<object, string>();

/** Response.json plus CORS, serializing each cached value at most once. */
export function cachedJson(value: Readonly<object>): Response {
	let body = bodies.get(value);
	if (body === undefined) {
		body = JSON.stringify(value);
		bodies.set(value, body);
	}
	return new Response(body, { headers: JSON_HEADERS });
}

export function corsRedirect(status: 302 | 307, location: string): Response {
	return new Response(null, {
		status,
		headers: { Location: location, ...CORS_HEADERS },
	});
}
