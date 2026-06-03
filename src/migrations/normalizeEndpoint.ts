/**
 * Shared endpoint normalization logic used by migrations.
 * Maps raw URL paths to consistent grouped endpoint names.
 */
export function normalizeEndpoint(endpoint: string): string {
	let path = endpoint;

	// Extract path from full URLs
	if (path.includes("localhost") || path.includes("http")) {
		try {
			const url = new URL(path);
			path = url.pathname;
		} catch {
			const pathMatch = path.match(/https?:\/\/[^/]+(\/.*)/);
			if (pathMatch?.[1]) {
				path = pathMatch[1];
			}
		}
	}

	// Apply grouping rules (order matters: specific patterns before general)
	if (path.match(/^\/users\/[^/]+\/purge$/) || path === "/reset") {
		return "/reset";
	} else if (path.match(/^\/users\/[^/]+\/r$/)) {
		return "/users/USER_ID/r";
	} else if (path.match(/^\/users\/[^/]+$/)) {
		return "/users/USER_ID";
	} else if (path.match(/^\/emojis\/[^/]+\/r$/)) {
		return "/emojis/EMOJI_NAME/r";
	} else if (path.match(/^\/emojis\/[^/]+$/)) {
		return "/emojis/EMOJI_NAME";
	} else if (path.includes("/users/") && path.includes("/r")) {
		return "/users/USER_ID/r";
	} else if (path.includes("/users/")) {
		return "/users/USER_ID";
	} else if (path.includes("/emojis/") && path.includes("/r")) {
		return "/emojis/EMOJI_NAME/r";
	} else if (path.includes("/emojis/")) {
		return "/emojis/EMOJI_NAME";
	} else if (path === "/") {
		return "/";
	} else if (path === "/health") {
		return "/health";
	} else if (path === "/dashboard") {
		return "/dashboard";
	} else if (path.startsWith("/swagger")) {
		return "/swagger";
	} else if (path === "/stats") {
		return "/stats";
	}

	return "/other";
}
