/**
 * Utility to build Bun-compatible routes from typed route definitions
 * and generate Swagger documentation
 */

import type { RouteDefinition } from "../types/routes";
import { swaggerGenerator } from "./swagger-generator";

type BunRoute = Record<
	string,
	(request: Request) => Promise<Response> | Response
>;

/**
 * Convert typed routes to Bun server format and generate Swagger
 */
export function buildRoutes(typedRoutes: Record<string, RouteDefinition>) {
	// Generate Swagger from typed routes
	swaggerGenerator.addRoutes(typedRoutes);

	// Convert to Bun server format
	const bunRoutes: Record<string, BunRoute> = {};

	Object.entries(typedRoutes).forEach(([path, routeConfig]) => {
		const bunRoute: Record<
			string,
			(request: Request) => Promise<Response> | Response
		> = {};

		// Convert each HTTP method
		Object.entries(routeConfig).forEach(([method, typedRoute]) => {
			if (typedRoute && "handler" in typedRoute) {
				bunRoute[method] = typedRoute.handler;
			}
		});

		bunRoutes[path] = bunRoute;
	});

	return bunRoutes;
}

/**
 * Get the generated Swagger specification
 */
export function getSwaggerSpec() {
	return swaggerGenerator.getSpec();
}

/**
 * Merge typed routes with existing legacy routes
 * This allows gradual migration
 */
export function mergeRoutes(
	typedRoutes: Record<string, RouteDefinition>,
	legacyRoutes: Record<string, BunRoute>,
) {
	const builtRoutes = buildRoutes(typedRoutes);

	return {
		...legacyRoutes,
		...builtRoutes,
	};
}
