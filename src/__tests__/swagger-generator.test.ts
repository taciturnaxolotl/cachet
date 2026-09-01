import { describe, expect, it } from "bun:test";
import { SwaggerGenerator } from "../lib/swagger-generator";
import { apiResponse, createRoute } from "../types/routes";

describe("SwaggerGenerator error responses", () => {
	it("publishes the structured error schema for declared and unexpected errors", () => {
		const generator = new SwaggerGenerator();
		generator.addRoutes({
			"/example": {
				GET: createRoute(() => Response.json({ ok: true }), {
					summary: "Example",
					responses: Object.fromEntries([
						apiResponse(200, "Success", { type: "object" }),
						apiResponse(404, "Not found"),
					]),
				}),
			},
		});

		type ErrorResponses = Record<
			string,
			{ content?: { "application/json": { schema: { $ref?: string } } } }
		>;
		const spec = generator.getSpec() as unknown as {
			paths: Record<string, Record<string, { responses: ErrorResponses }>>;
			components: { schemas: Record<string, unknown> };
		};
		const responses = spec.paths["/example"]?.get?.responses;
		const errorRef = (status: string) =>
			responses?.[status]?.content?.["application/json"].schema.$ref;

		expect(spec.components.schemas.ErrorResponse).toBeDefined();
		expect(errorRef("404")).toBe("#/components/schemas/ErrorResponse");
		expect(errorRef("500")).toBe("#/components/schemas/ErrorResponse");
	});
});
