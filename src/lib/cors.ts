/**
 * Shared CORS utilities
 */

export const CORS_HEADERS: Record<string, string> = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
	"Access-Control-Allow-Headers":
		"Content-Type, Authorization, X-Requested-With",
	"Access-Control-Max-Age": "86400",
};

// Pre-built entries array to avoid Object.entries() allocation per request
const CORS_ENTRIES = Object.entries(CORS_HEADERS);

/**
 * Adds CORS headers to a response.
 * Tries in-place mutation first; falls back to new Response if headers are immutable.
 */
export function addCorsHeaders(response: Response): Response {
	try {
		for (let i = 0; i < CORS_ENTRIES.length; i++) {
			response.headers.set(CORS_ENTRIES[i][0], CORS_ENTRIES[i][1]);
		}
		return response;
	} catch {
		// Headers are immutable (e.g. Response.json()), create new response
		const headers = new Headers(response.headers);
		for (let i = 0; i < CORS_ENTRIES.length; i++) {
			headers.set(CORS_ENTRIES[i][0], CORS_ENTRIES[i][1]);
		}
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers,
		});
	}
}

export function corsPreflightResponse(): Response {
	return new Response(null, { status: 204, headers: CORS_HEADERS });
}
