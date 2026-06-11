/**
 * Fast URL path/query extraction without `new URL()` overhead.
 * Bun's request.url is always an absolute URL like "http://localhost:3000/users/U123?foo=bar"
 * so we can skip the full URL parser for hot-path handlers.
 */

/** Extract pathname from a request URL string. Avoids `new URL()` allocation. */
export function fastPathname(url: string): string {
	// Skip "http://host:port" prefix — find the third slash
	const i = url.indexOf("/", 8); // skip "http://" (7) or "https://" (8)
	if (i === -1) return "/";
	const q = url.indexOf("?", i);
	return q === -1 ? url.substring(i) : url.substring(i, q);
}

/** Extract the last path segment (e.g. userId or emoji name). */
export function lastSegment(url: string): string {
	const path = fastPathname(url);
	const i = path.lastIndexOf("/");
	return i === -1 ? path : path.substring(i + 1);
}

/** Extract a specific path segment by index (0-based after leading slash). */
export function pathSegment(url: string, index: number): string {
	const path = fastPathname(url);
	// Split lazily — only allocate array when needed
	let seg = 0;
	let start = 1; // skip leading "/"
	for (let i = 1; i <= path.length; i++) {
		if (i === path.length || path.charCodeAt(i) === 47 /* / */) {
			if (seg === index) return path.substring(start, i);
			seg++;
			start = i + 1;
		}
	}
	return "";
}

/** Extract a query parameter value by name without URLSearchParams. */
export function queryParam(url: string, name: string): string | null {
	const q = url.indexOf("?");
	if (q === -1) return null;

	const target = `${name}=`;
	let i = q + 1;
	while (i < url.length) {
		const amp = url.indexOf("&", i);
		const end = amp === -1 ? url.length : amp;
		if (url.startsWith(target, i)) {
			return decodeURIComponent(url.substring(i + target.length, end));
		}
		i = end + 1;
	}
	return null;
}
