import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { generateKotlinModels, KOTLIN_PACKAGE, type OpenApiDocument, operationName } from "./generate";
import { buildSamples, FUTURE_ENUM_VALUE, FUTURE_PROPERTY } from "./samples";

const ROOT = path.resolve(__dirname, "../..");
const doc = JSON.parse(readFileSync(path.join(ROOT, "docs/openapi.json"), "utf8")) as OpenApiDocument;

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

/** A one-operation document for the mapping tests. */
function single(request: Record<string, unknown> | undefined, response: Record<string, unknown>, schemas = {}): OpenApiDocument {
  return {
    paths: {
      "/api/v1/things/{id}": {
        patch: {
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          ...(request ? { requestBody: { content: { "application/json": { schema: request } } } } : {}),
          responses: { 200: { description: "ok", content: { "application/json": { schema: response } } } },
        },
      },
    },
    components: { schemas },
  };
}

const contentOf = (files: ReturnType<typeof generateKotlinModels>, file: string) =>
  files.find((f) => f.path === file)?.content ?? "";

describe("committed Kotlin models", () => {
  it("are what docs/openapi.json generates (run `pnpm mobile:models` after changing the API)", () => {
    const dir = path.join(ROOT, "mobile/core/src/commonMain/kotlin", ...KOTLIN_PACKAGE.split("."));
    const committed = new Map(filesUnder(dir).map((f) => [path.relative(dir, f), readFileSync(f, "utf8")]));
    const generated = new Map(generateKotlinModels(doc).map((f) => [f.path, f.content]));

    expect([...committed.keys()].sort()).toEqual([...generated.keys()].sort());
    const stale = [...generated].filter(([file, content]) => committed.get(file) !== content).map(([file]) => file);
    expect(stale).toEqual([]);
  });

  it("have matching contract-test samples", () => {
    const dir = path.join(ROOT, "mobile/core/src/commonTest/resources/api-samples");
    const samples = buildSamples(doc);
    const committed = readdirSync(dir).sort();
    expect(committed).toEqual([...samples.keys()].map((name) => `${name}.json`).sort());
    const stale = [...samples].filter(([name, sample]) => readFileSync(path.join(dir, `${name}.json`), "utf8") !== `${JSON.stringify(sample, null, 2)}\n`);
    expect(stale.map(([name]) => name)).toEqual([]);
  });
});

describe("operationName", () => {
  it("names operations by method and path, with path parameters as By<Name>", () => {
    expect(operationName("get", "/api/v1/workouts/{id}/sets")).toBe("GetWorkoutsByIdSets");
    expect(operationName("post", "/api/v1/strava/native/complete")).toBe("PostStravaNativeComplete");
    expect(operationName("delete", "/api/v1/nutrition/meal-targets/{mealType}")).toBe("DeleteNutritionMealTargetsByMealType");
  });
});

describe("generateKotlinModels mapping rules", () => {
  it("declares an optional nullable request field as Patch, and other optionals as nullable with a null default", () => {
    const files = generateKotlinModels(
      single(
        { type: "object", properties: { age: { type: "integer", nullable: true }, name: { type: "string" }, note: { type: "string", nullable: true } }, required: ["note"] },
        { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
      ),
    );
    const op = contentOf(files, "operation/PatchThingsById.kt");

    expect(op).toContain("public val age: Patch<Long> = Patch.Absent,");
    expect(op).toContain("public val name: String? = null,");
    expect(op).toContain("public val note: String?,");
  });

  it("gives response fields that may be null a null default, so a missing one still decodes", () => {
    const files = generateKotlinModels(
      single(undefined, { type: "object", properties: { at: { type: "string", nullable: true }, n: { type: "integer", minimum: 0, maximum: 10 } }, required: ["at", "n"] }),
    );
    const op = contentOf(files, "operation/PatchThingsById.kt");

    expect(op).toContain("public val at: String? = null,");
    expect(op).toContain("public val n: Int,");
  });

  it("emits enums with an Unknown fallback, nested in their owner", () => {
    const files = generateKotlinModels(
      single(undefined, { type: "object", properties: { status: { type: "string", enum: ["per_side", "total"] } }, required: ["status"] }),
    );
    const op = contentOf(files, "operation/PatchThingsByIdResponse.kt") || contentOf(files, "operation/PatchThingsById.kt");

    expect(op).toContain("public enum class Status(override val wireValue: String) : WireEnum {");
    expect(op).toContain('PerSide("per_side"),');
    expect(op).toContain('Unknown(""),');
    expect(op).toContain("WireEnumSerializer<Status>");
  });

  it("reads allOf [ref, {nullable}] as a nullable reference and allOf [ref, {properties}] as one merged class", () => {
    const schemas = { Base: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } };
    const files = generateKotlinModels(
      single(
        undefined,
        {
          type: "object",
          properties: {
            maybe: { allOf: [{ $ref: "#/components/schemas/Base" }, { nullable: true }] },
            extended: { allOf: [{ $ref: "#/components/schemas/Base" }, { type: "object", properties: { extra: { type: "number" } }, required: ["extra"] }] },
          },
          required: ["maybe", "extended"],
        },
        schemas,
      ),
    );
    const op = contentOf(files, "operation/PatchThingsById.kt");

    expect(op).toContain("public val maybe: Base? = null,");
    expect(op).toContain("public val extended: PatchThingsByIdResponse.Extended,");
    expect(op).toMatch(/data class Extended\(\n\s+public val id: String,\n\s+public val extra: Double,/);
  });

  it("maps unions to raw JSON and whole-number numeric enums to Int", () => {
    const files = generateKotlinModels(
      single(undefined, {
        type: "object",
        properties: {
          either: { oneOf: [{ type: "string" }, { type: "object", properties: { a: { type: "string" } } }] },
          meals: { type: "number", enum: [3, 4, 5] },
        },
        required: ["either", "meals"],
      }),
    );
    const op = contentOf(files, "operation/PatchThingsById.kt");

    expect(op).toContain("public val either: JsonElement,");
    expect(op).toContain("public val meals: Int,");
  });

  it("generates a typed path builder for each endpoint with path parameters", () => {
    const endpoints = contentOf(generateKotlinModels(single(undefined, { type: "object", properties: {} })), "ApiEndpoints.kt");

    expect(endpoints).toContain("public object PatchThingsById : ApiEndpoint<Unit, JsonObject>(");
    expect(endpoints).toContain('buildPath("id" to id)');
    expect(endpoints).toContain('"PatchThingsById" to PatchThingsById,');
  });
});

describe("buildSamples", () => {
  it("builds min, max and future variants, with an unknown property and enum value in future", () => {
    const samples = buildSamples(
      single(undefined, {
        type: "object",
        properties: { status: { type: "string", enum: ["a", "b"] }, note: { type: "string", nullable: true } },
        required: ["status", "note"],
      }),
    );
    const response = samples.get("PatchThingsById")?.response;

    expect(response?.min).toEqual({ status: "a", note: null });
    expect(response?.max).toEqual({ status: "b", note: "sample text" });
    expect(response?.future).toEqual({ status: FUTURE_ENUM_VALUE, note: "sample text", [FUTURE_PROPERTY]: { added: true } });
  });
});
