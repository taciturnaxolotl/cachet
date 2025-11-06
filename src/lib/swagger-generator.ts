/**
 * Generates Swagger/OpenAPI specifications from typed route definitions
 */

import { version } from "../../package.json";
import type {
	HttpMethod,
	RouteDefinition,
	RouteMetadata,
	RouteParam,
} from "../types/routes";

interface SecurityScheme {
	type: string;
	scheme: string;
}

interface SwaggerSpec {
	openapi: string;
	info: {
		title: string;
		version: string;
		description: string;
		contact: {
			name: string;
			email: string;
		};
		license: {
			name: string;
			url: string;
		};
	};
	paths: Record<string, Record<string, unknown>>;
	components?: {
		securitySchemes?: Record<string, SecurityScheme>;
	};
}

export class SwaggerGenerator {
	private spec: SwaggerSpec;

	constructor() {
		this.spec = {
			openapi: "3.0.0",
			info: {
				title: "Cachet",
				version: version,
				description:
					"A high-performance cache and proxy for Slack profile pictures and emojis with comprehensive analytics.",
				contact: {
					name: "Kieran Klukas",
					email: "me@dunkirk.sh",
				},
				license: {
					name: "AGPL 3.0",
					url: "https://github.com/taciturnaxolotl/cachet/blob/main/LICENSE.md",
				},
			},
			paths: {},
			components: {
				securitySchemes: {
					bearerAuth: {
						type: "http",
						scheme: "bearer",
					},
				},
			},
		};
	}

	/**
	 * Add routes to the Swagger specification
	 */
	addRoutes(routes: Record<string, RouteDefinition>) {
		Object.entries(routes).forEach(([path, routeConfig]) => {
			// Skip non-API routes
			if (
				typeof routeConfig === "function" ||
				path.includes("dashboard") ||
				path.includes("swagger") ||
				path.includes("favicon")
			) {
				return;
			}

			this.addRoute(path, routeConfig);
		});
	}

	/**
	 * Add a single route to the specification
	 */
	private addRoute(path: string, routeConfig: RouteDefinition) {
		const swaggerPath = this.convertPathToSwagger(path);

		if (!this.spec.paths[swaggerPath]) {
			this.spec.paths[swaggerPath] = {};
		}

		// Process each HTTP method
		Object.entries(routeConfig).forEach(([method, typedRoute]) => {
			if (
				typeof typedRoute === "object" &&
				"handler" in typedRoute &&
				"metadata" in typedRoute
			) {
				const swaggerMethod = method.toLowerCase();
				const methodSpec = this.buildMethodSpec(
					method as HttpMethod,
					typedRoute.metadata,
				);
				// Ensure spec.paths is properly initialized before adding method
				if (this.spec.paths[swaggerPath]) {
					this.spec.paths[swaggerPath][swaggerMethod] = methodSpec;
				}
			}
		});
	}

	/**
	 * Convert Express-style path to Swagger format
	 * /users/:id -> /users/{id}
	 */
	private convertPathToSwagger(path: string): string {
		return path.replace(/:([^/]+)/g, "{$1}");
	}

	/**
	 * Build Swagger specification for a single method
	 */
	private buildMethodSpec(method: HttpMethod, metadata: RouteMetadata) {
		const spec: Record<string, unknown> = {
			summary: metadata.summary,
			description: metadata.description,
			tags: metadata.tags || ["API"],
			responses: {},
		};

		// Add parameters
		if (metadata.parameters) {
			spec.parameters = [] as Record<string, unknown>[];

			// Path parameters
			if (metadata.parameters.path) {
				metadata.parameters.path.forEach((param) => {
					(spec.parameters as Record<string, unknown>[]).push(
						this.buildParameterSpec(param, "path"),
					);
				});
			}

			// Query parameters
			if (metadata.parameters.query) {
				metadata.parameters.query.forEach((param) => {
					(spec.parameters as Record<string, unknown>[]).push(
						this.buildParameterSpec(param, "query"),
					);
				});
			}

			// Request body
			if (
				metadata.parameters.body &&
				["POST", "PUT", "PATCH"].includes(method)
			) {
				spec.requestBody = {
					required: true,
					content: {
						"application/json": {
							schema: metadata.parameters.body,
						},
					},
				};
			}
		}

		// Add responses
		Object.entries(metadata.responses).forEach(([status, response]) => {
			(spec.responses as Record<string, unknown>)[status] = {
				description: response.description,
				...(response.schema && {
					content: {
						"application/json": {
							schema: response.schema,
						},
					},
				}),
			};
		});

		// Add security if required
		if (metadata.requiresAuth) {
			spec.security = [{ bearerAuth: [] }];
		}

		return spec;
	}

	/**
	 * Build parameter specification
	 */
	private buildParameterSpec(param: RouteParam, location: "path" | "query") {
		const schema: Record<string, unknown> = { type: param.type };
		if (param.example !== undefined) {
			schema.example = param.example;
		}

		return {
			name: param.name,
			in: location,
			required: param.required,
			description: param.description,
			schema,
		};
	}

	/**
	 * Get the complete Swagger specification
	 */
	getSpec(): SwaggerSpec {
		return this.spec;
	}

	/**
	 * Generate JSON string of the specification
	 */
	toJSON(): string {
		return JSON.stringify(this.spec, null, 2);
	}
}

// Export singleton instance
export const swaggerGenerator = new SwaggerGenerator();
