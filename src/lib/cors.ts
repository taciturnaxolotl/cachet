/**
 * Shared CORS utilities
 */

export const CORS_HEADERS: Record<string, string> = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
	"Access-Control-Max-Age": "86400",
};

export function addCorsHeaders(response: Response): Response {
	const headers = new Headers(response.headers);
	for (const [key, value] of Object.entries(CORS_HEADERS)) {
		headers.set(key, value);
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export function corsPreflightResponse(): Response {
	return new Response(null, { status: 204, headers: CORS_HEADERS });
}
