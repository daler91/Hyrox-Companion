import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { generateOpenApiDocument } from "./openapi";

type Doc = ReturnType<typeof generateOpenApiDocument>;
type Operation = { responses: Record<string, { content?: Record<string, { schema?: { $ref?: string; type?: string; items?: { $ref?: string } } }> }> };

function operation(doc: Doc, route: string, method: string): Operation {
  const paths = doc.paths as Record<string, Record<string, Operation>>;
  const op = paths[route]?.[method];
  if (!op) throw new Error(`${method.toUpperCase()} ${route} is not registered`);
  return op;
}

function okSchema(op: Operation) {
  return op.responses["200"]?.content?.["application/json"]?.schema;
}

/**
 * The registry behind docs/openapi.json and /api/docs. Nothing exercised it
 * before (T2): the snapshot gate in CI only proved the file was regenerated,
 * not that the document said anything true. These pin the shapes the
 * endpoints actually return.
 */
describe("generateOpenApiDocument", () => {
  const doc = generateOpenApiDocument();

  it("registers the workout CRUD and preferences operations", () => {
    expect(Object.keys(doc.paths ?? {}).sort()).toEqual([
      "/api/v1/preferences",
      "/api/v1/workouts",
      "/api/v1/workouts/{id}",
    ]);
    expect(Object.keys(doc.paths?.["/api/v1/workouts/{id}"] ?? {}).sort()).toEqual(["delete", "get", "patch"]);
  });

  it("documents responses as stored rows, not insert payloads", () => {
    expect(okSchema(operation(doc, "/api/v1/workouts", "post"))?.$ref).toBe("#/components/schemas/WorkoutLogWithSets");
    expect(okSchema(operation(doc, "/api/v1/workouts", "get"))?.items?.$ref).toBe("#/components/schemas/WorkoutLog");
    expect(okSchema(operation(doc, "/api/v1/workouts/{id}", "get"))?.$ref).toBe("#/components/schemas/WorkoutLogDetail");
    expect(okSchema(operation(doc, "/api/v1/workouts/{id}", "patch"))?.$ref).toBe("#/components/schemas/WorkoutLogWithSets");
    expect(okSchema(operation(doc, "/api/v1/preferences", "patch"))?.$ref).toBe("#/components/schemas/PreferencesResponse");

    const schemas = doc.components?.schemas as Record<string, { properties?: Record<string, unknown>; required?: string[] }>;
    expect(Object.keys(schemas.WorkoutLog.properties ?? {})).toEqual(expect.arrayContaining(["id", "userId", "date", "focus", "mainWorkout"]));
    expect(Object.keys(schemas.WorkoutLogDetail.properties ?? {})).toEqual(expect.arrayContaining(["exerciseSets", "structureBlocks"]));
    expect(schemas.WorkoutLogDetail.required).toEqual(expect.arrayContaining(["exerciseSets", "structureBlocks"]));
  });

  it("states its own coverage so a reader does not mistake it for the whole API", () => {
    expect(doc.info.description).toMatch(/workout CRUD and preferences endpoints only/);
  });

  it("matches the committed docs/openapi.json snapshot", () => {
    const committed = JSON.parse(readFileSync(path.resolve(__dirname, "..", "docs", "openapi.json"), "utf8"));
    expect(JSON.parse(JSON.stringify(doc))).toEqual(committed);
  });
});
