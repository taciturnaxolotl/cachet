/**
 * Type-safe route system that generates Swagger documentation from route definitions
 * This ensures the Swagger docs stay in sync with the actual API implementation
 */

// Base types for HTTP methods
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

// Parameter types
export interface RouteParam {
	name: string;
	type: "string" | "number" | "boolean";
	required: boolean;
	description: string;
	example?: unknown;
}

// Response types
export interface ApiResponse {
	status: number;
	description: string;
	schema?: Record<string, unknown>; // JSON Schema or example object
}

// Route metadata for Swagger generation
export interface RouteMetadata {
	summary: string;
	description?: string;
	tags?: string[];
	parameters?: {
		path?: RouteParam[];
		query?: RouteParam[];
		body?: Record<string, unknown>; // JSON Schema for request body
	};
	responses: Record<number, ApiResponse>;
	requiresAuth?: boolean;
}

// Handler function type
export type RouteHandler = (request: Request) => Promise<Response> | Response;

// Enhanced route definition that includes metadata
export interface TypedRoute {
	handler: RouteHandler;
	metadata: RouteMetadata;
}

// Method-specific route definitions (matching Bun's pattern)
export interface RouteDefinition {
	GET?: TypedRoute;
	POST?: TypedRoute;
	PUT?: TypedRoute;
	DELETE?: TypedRoute;
	PATCH?: TypedRoute;
}

// Type helper to create routes with metadata
export function createRoute(
	handler: RouteHandler,
	metadata: RouteMetadata,
): TypedRoute {
	return { handler, metadata };
}

// Type helper for path parameters
export function pathParam(
	name: string,
	type: RouteParam["type"] = "string",
	description: string,
	example?: unknown,
): RouteParam {
	return { name, type, required: true, description, example };
}

// Type helper for query parameters
export function queryParam(
	name: string,
	type: RouteParam["type"] = "string",
	description: string,
	required = false,
	example?: unknown,
): RouteParam {
	return { name, type, required, description, example };
}

// Type helper for API responses
export function apiResponse(
	status: number,
	description: string,
	schema?: Record<string, unknown>,
): [number, ApiResponse] {
	return [status, { status, description, schema }];
}
