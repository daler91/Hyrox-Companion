import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findBreakingChanges } from "./openapiBreaking";

type Doc = Parameters<typeof findBreakingChanges>[0];

/** A one-operation document: POST /api/v1/thing with the given request and 200 response schemas. */
function doc(
  response: Record<string, unknown>,
  request?: Record<string, unknown>,
  extra: { parameters?: unknown[]; schemas?: Record<string, Record<string, unknown>> } = {},
): Doc {
  return {
    paths: {
      "/api/v1/thing": {
        post: {
          ...(extra.parameters ? { parameters: extra.parameters } : {}),
          ...(request
            ? { requestBody: { required: true, content: { "application/json": { schema: request } } } }
            : {}),
          responses: { 200: { description: "ok", content: { "application/json": { schema: response } } } },
        },
      },
    },
    components: { schemas: extra.schemas ?? {} },
  };
}

const obj = (properties: Record<string, unknown>, required: string[] = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
});

const messages = (base: Doc, head: Doc) =>
  findBreakingChanges(base, head).map((f) => `${f.severity}: ${f.location}: ${f.message}`);

describe("findBreakingChanges", () => {
  const base = doc(obj({ id: { type: "string" }, count: { type: "integer" } }), obj({ name: { type: "string" } }));

  it("finds nothing between identical documents", () => {
    expect(findBreakingChanges(base, base)).toEqual([]);
  });

  it("allows additive changes: a new operation, a new response field, a new optional request field", () => {
    const head = doc(
      obj({ id: { type: "string" }, count: { type: "integer" }, extra: { type: "string" } }),
      obj({ name: { type: "string" }, note: { type: "string" } }, ["name"]),
    );
    head.paths!["/api/v1/other"] = { get: { responses: {} } };

    expect(findBreakingChanges(base, head)).toEqual([]);
  });

  it("flags a removed operation", () => {
    expect(messages(base, { paths: {} })).toEqual(["breaking: POST /api/v1/thing: operation removed"]);
  });

  it("flags a removed success response", () => {
    const head = structuredClone(base);
    (head.paths!["/api/v1/thing"].post as { responses: Record<string, unknown> }).responses = { 201: {} };

    expect(messages(base, head)).toEqual(["breaking: POST /api/v1/thing response 200: success response removed"]);
  });

  it("flags a removed response field, a type change and a field that stops being required", () => {
    const head = doc(obj({ count: { type: "string" } }, []), obj({ name: { type: "string" } }));

    expect(messages(base, head)).toEqual([
      "breaking: POST /api/v1/thing response 200.id: response field removed",
      "breaking: POST /api/v1/thing response 200.count: response field is no longer always present",
      "breaking: POST /api/v1/thing response 200.count: type changed from integer to string",
    ]);
  });

  it("flags a response value that becomes nullable", () => {
    const head = doc(obj({ id: { type: "string", nullable: true }, count: { type: "integer" } }), obj({ name: { type: "string" } }));

    expect(messages(base, head)).toEqual(["breaking: POST /api/v1/thing response 200.id: response value can now be null"]);
  });

  it("flags new required request fields and newly required existing ones", () => {
    const before = doc(obj({}), obj({ name: { type: "string" }, note: { type: "string" } }, ["name"]));
    const after = doc(obj({}), obj({ name: { type: "string" }, note: { type: "string" }, kind: { type: "string" } }));

    expect(messages(before, after)).toEqual([
      "breaking: POST /api/v1/thing request.note: request field is now required",
      "breaking: POST /api/v1/thing request.kind: new required request field",
    ]);
  });

  it("flags a request enum losing a value, and only warns when a response enum gains one", () => {
    const before = doc(obj({ status: { type: "string", enum: ["a", "b"] } }), obj({ platform: { type: "string", enum: ["android", "ios"] } }));
    const after = doc(obj({ status: { type: "string", enum: ["a", "b", "c"] } }), obj({ platform: { type: "string", enum: ["android"] } }));

    expect(messages(before, after)).toEqual([
      "warning: POST /api/v1/thing response 200.status: response enum gained c; strict enum decoding in older apps fails on it",
      "breaking: POST /api/v1/thing request.platform: request enum no longer accepts ios",
    ]);
  });

  it("flags tightened request length limits and a new required parameter", () => {
    const before = doc(obj({}), obj({ token: { type: "string", maxLength: 4096 } }));
    const after = doc(obj({}), obj({ token: { type: "string", maxLength: 256 } }), {
      parameters: [{ name: "since", in: "query", required: true, schema: { type: "string" } }],
    });

    expect(messages(before, after)).toEqual([
      "breaking: POST /api/v1/thing request.token: request maxLength tightened to 256",
      "breaking: POST /api/v1/thing query parameter since: new required parameter",
    ]);
  });

  it("follows $refs into components and walks array items", () => {
    const schemas = (count: Record<string, unknown>) => ({ Item: obj({ count }) });
    const before = doc({ type: "array", items: { $ref: "#/components/schemas/Item" } }, undefined, {
      schemas: schemas({ type: "integer" }),
    });
    const after = doc({ type: "array", items: { $ref: "#/components/schemas/Item" } }, undefined, {
      schemas: schemas({ type: "boolean" }),
    });

    expect(messages(before, after)).toEqual([
      "breaking: POST /api/v1/thing response 200[].count: type changed from integer to boolean",
    ]);
  });

  it("terminates on a recursive schema", () => {
    const schemas = { Node: obj({ child: { $ref: "#/components/schemas/Node" } }, []) };
    const recursive = doc({ $ref: "#/components/schemas/Node" }, undefined, { schemas });

    expect(findBreakingChanges(recursive, recursive)).toEqual([]);
  });

  it("finds nothing comparing the committed document with itself", () => {
    const committed = JSON.parse(readFileSync(path.resolve(__dirname, "../docs/openapi.json"), "utf8")) as Doc;

    expect(findBreakingChanges(committed, committed)).toEqual([]);
  });
});
