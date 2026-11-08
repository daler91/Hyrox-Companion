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

  it("registers every area, from workout CRUD to the native-app paths", () => {
    // Completeness against the server's routes is test/docs/openapiCoverage.test.ts;
    // this pins a path from each area module so a dropped registration is obvious.
    expect(Object.keys(doc.paths ?? {})).toEqual(
      expect.arrayContaining([
        "/api/v1/workouts",
        "/api/v1/workouts/{id}",
        "/api/v1/preferences",
        "/api/v1/auth/user",
        "/api/v1/push/devices",
        "/api/v1/strava/native/complete",
        "/api/v1/garmin/status",
        "/api/v1/health-connect/sync",
        "/api/v1/timeline",
        "/api/v1/chat/stream",
        "/api/v1/plans",
        "/api/v1/nutrition/logs",
        "/api/v1/training-overview",
      ]),
    );
    expect(Object.keys(doc.paths?.["/api/v1/workouts/{id}"] ?? {}).sort()).toEqual(["delete", "get", "patch"]);
    expect(Object.keys(doc.paths?.["/api/v1/preferences"] ?? {}).sort()).toEqual(["get", "patch"]);
  });

  it("describes both error envelopes and the native app's 426 on authenticated operations", () => {
    const schemas = doc.components?.schemas ?? {};
    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining(["ErrorResponse", "ValidationErrorResponse", "AppUpdateRequiredResponse"]),
    );
    const responses = operation(doc, "/api/v1/push/devices", "post").responses;
    expect(Object.keys(responses).sort()).toEqual(["200", "400", "401", "404", "426", "429"]);
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
    expect(doc.info.description).toMatch(/every client route/);
    expect(doc.info.description).toMatch(/test\/docs\/openapiCoverage\.test\.ts/);
  });

  it("resolves every $ref, including the raw ones some path modules write by hand", () => {
    const components = doc.components as Record<string, Record<string, unknown> | undefined>;
    const unresolved = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      if (typeof value !== "object" || value === null) return;
      const ref = (value as { $ref?: unknown }).$ref;
      if (typeof ref === "string") {
        const match = /^#\/components\/(\w+)\/(.+)$/.exec(ref);
        if (!match || components[match[1] ?? ""]?.[match[2] ?? ""] === undefined) unresolved.add(ref);
      }
      Object.values(value).forEach(walk);
    };
    walk(doc);
    expect([...unresolved]).toEqual([]);
  });

  it("gives every operation a security requirement and the shared 401", () => {
    const missing: string[] = [];
    for (const [route, item] of Object.entries(doc.paths ?? {})) {
      for (const [method, op] of Object.entries(item as Record<string, Operation & { security?: unknown[] }>)) {
        if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
        if (!op.security?.length || !op.responses["401"]) missing.push(`${method.toUpperCase()} ${route}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("matches the committed docs/openapi.json snapshot", () => {
    const committed = JSON.parse(readFileSync(path.resolve(__dirname, "..", "docs", "openapi.json"), "utf8"));
    expect(JSON.parse(JSON.stringify(doc))).toEqual(committed);
  });
});
