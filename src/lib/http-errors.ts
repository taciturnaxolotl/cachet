import { fastPathname } from "./fast-url";

export interface ApiErrorBody {
	error: {
		code: string;
		message: string;
		hint: string;
	};
}

export function jsonError(
	status: number,
	code: string,
	message: string,
	hint: string,
	init: { headers?: Record<string, string>; extra?: object } = {},
): Response {
	return Response.json(
		{
			...init.extra,
			error: { code, message, hint },
		} satisfies ApiErrorBody,
		{ status, headers: init.headers },
	);
}

export function notFoundResponse(request: Request): Response {
	const pathname = fastPathname(request.url);
	return jsonError(
		404,
		"ROUTE_NOT_FOUND",
		`No endpoint exists at ${pathname}.`,
		"See /swagger.json for the machine-readable API specification.",
	);
}

export function methodNotAllowedResponse(
	request: Request,
	allowedMethods: string[],
): Response {
	return jsonError(
		405,
		"METHOD_NOT_ALLOWED",
		`${request.method} is not supported for ${fastPathname(request.url)}.`,
		`Retry with one of the supported methods: ${allowedMethods.join(", ")}.`,
		{ headers: { Allow: allowedMethods.join(", ") } },
	);
}

export function internalErrorResponse(): Response {
	return jsonError(
		500,
		"INTERNAL_ERROR",
		"The server could not complete the request.",
		"Retry later. If the problem persists, report the endpoint and request time to the service operator.",
	);
}

function routeMatches(pattern: string, pathname: string): boolean {
	const patternSegments = pattern.split("/");
	const pathSegments = pathname.split("/");
	return (
		patternSegments.length === pathSegments.length &&
		patternSegments.every(
			(segment, index) =>
				segment.startsWith(":") || segment === pathSegments[index],
		)
	);
}

const HTTP_METHODS = new Set([
	"GET",
	"POST",
	"PUT",
	"DELETE",
	"PATCH",
	"HEAD",
	"OPTIONS",
]);

function methodsForRoute(route: unknown): string[] {
	if (typeof route !== "object" || route === null) return ["GET"];

	const methods = Object.keys(route).filter((key) => HTTP_METHODS.has(key));
	return methods.length > 0 ? methods : ["GET"];
}

export function createFallbackHandler(
	routes: Record<string, unknown>,
): (request: Request) => Response {
	const routeMethods = Object.fromEntries(
		Object.entries(routes).map(([path, route]) => [
			path,
			methodsForRoute(route),
		]),
	);
	const dynamicRoutes = Object.entries(routeMethods).filter(([pattern]) =>
		pattern.includes(":"),
	);

	return (request: Request) => {
		const pathname = fastPathname(request.url);
		const allowedMethods =
			routeMethods[pathname] ??
			dynamicRoutes.find(([pattern]) => routeMatches(pattern, pathname))?.[1];

		if (allowedMethods) {
			return methodNotAllowedResponse(request, allowedMethods);
		}
		return notFoundResponse(request);
	};
}
