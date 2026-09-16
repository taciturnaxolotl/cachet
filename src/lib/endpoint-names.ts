/**
 * Maps a request path to the human-readable bucket the dashboard groups it
 * under.
 *
 * Pure string handling with no database involvement, which is why it lives
 * apart from the analytics queries that happen to call it.
 */

/** Groups endpoint names for display. */
export function groupEndpoint(endpoint: string): string {
	if (endpoint === "/" || endpoint === "/dashboard") {
		return "Dashboard";
	} else if (endpoint === "/health") {
		return "Health Check";
	} else if (endpoint === "/swagger" || endpoint.startsWith("/swagger")) {
		return "API Documentation";
	} else if (endpoint === "/emojis") {
		return "Emoji List";
	} else if (
		endpoint.match(/^\/users\/[^/]+\/purge$/) ||
		endpoint === "/emojis/purge" ||
		endpoint === "/reset"
	) {
		return "Cache Management";
	} else if (
		endpoint.match(/^\/emojis\/[^/]+$/) ||
		endpoint === "/emojis/EMOJI_NAME"
	) {
		return "Emoji Data";
	} else if (
		endpoint.match(/^\/emojis\/[^/]+\/r$/) ||
		endpoint === "/emojis/EMOJI_NAME/r"
	) {
		return "Emoji Redirects";
	} else if (
		endpoint.match(/^\/users\/[^/]+$/) ||
		endpoint === "/users/USER_ID"
	) {
		return "User Data";
	} else if (
		endpoint.match(/^\/users\/[^/]+\/r$/) ||
		endpoint === "/users/USER_ID/r"
	) {
		return "User Redirects";
	} else if (endpoint.includes("/users/") && endpoint.includes("/r")) {
		return "User Redirects";
	} else if (endpoint.includes("/users/")) {
		return "User Data";
	} else if (endpoint.includes("/emojis/") && endpoint.includes("/r")) {
		return "Emoji Redirects";
	} else if (endpoint.includes("/emojis/")) {
		return "Emoji Data";
	}
	return "Other";
}
