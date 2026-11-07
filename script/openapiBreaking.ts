/**
 * Breaking-change check between two OpenAPI documents (docs/openapi.json on
 * the base branch vs. this branch).
 *
 * Installed native apps call the API for months after a release, with models
 * generated from the document, so a change that would break an older build
 * must not ship by accident (docs/mobile-app-plan.md). This reports, for every
 * operation the base document describes:
 *
 *   breaking  — the operation or a success response is gone; a response field
 *               is removed, changes type, stops being required or becomes
 *               nullable; a request gains a required field or parameter, a
 *               field changes type, loses an enum value or tightens a length.
 *   warning   — a response enum gains a value (strict enum decoding fails on
 *               it), or a pattern or union schema changes shape.
 *
 * Written here rather than pulled in as a CI action: it covers exactly what
 * this repo's generated document can express (zod-to-openapi output: $ref,
 * objects, arrays, enums, nullable, oneOf/anyOf/allOf), and needs no
 * third-party pin to trust.
 */

export type Severity = "breaking" | "warning";

export interface Finding {
  severity: Severity;
  /** `METHOD /path`, plus where in it, e.g. `response 200 .connected`. */
  location: string;
  message: string;
}

type Schema = Record<string, unknown>;
interface OpenApiDoc {
  paths?: Record<string, Record<string, unknown>>;
  components?: { schemas?: Record<string, Schema> };
}

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Follow `#/components/schemas/X` references (and nothing else) within one document. */
function deref(doc: OpenApiDoc, schema: unknown, seen = new Set<string>()): Schema | undefined {
  if (!isObject(schema)) return undefined;
  const ref = schema.$ref;
  if (typeof ref !== "string") return schema;
  const name = /^#\/components\/schemas\/(.+)$/.exec(ref)?.[1];
  if (!name || seen.has(name)) return undefined;
  seen.add(name);
  return deref(doc, doc.components?.schemas?.[name], seen);
}

function typeOf(schema: Schema): string | undefined {
  return typeof schema.type === "string" ? schema.type : undefined;
}

function isNullable(schema: Schema): boolean {
  return schema.nullable === true;
}

function requiredSet(schema: Schema): Set<string> {
  return new Set(Array.isArray(schema.required) ? schema.required.filter((r): r is string => typeof r === "string") : []);
}

function enumValues(schema: Schema): unknown[] | undefined {
  return Array.isArray(schema.enum) ? schema.enum : undefined;
}

function union(schema: Schema): unknown[] | undefined {
  for (const key of ["oneOf", "anyOf", "allOf"] as const) {
    if (Array.isArray(schema[key])) return schema[key] as unknown[];
  }
  return undefined;
}

type Direction = "request" | "response";

interface CompareContext {
  base: OpenApiDoc;
  head: OpenApiDoc;
  findings: Finding[];
  /** Base/head schema pairs already compared, so recursive schemas terminate. */
  visited: Set<string>;
}

function compareSchemas(
  ctx: CompareContext,
  baseRaw: unknown,
  headRaw: unknown,
  direction: Direction,
  location: string,
): void {
  const pairKey = `${direction}|${JSON.stringify(baseRaw)}|${JSON.stringify(headRaw)}`;
  if (ctx.visited.has(pairKey)) return;
  ctx.visited.add(pairKey);

  const base = deref(ctx.base, baseRaw);
  const head = deref(ctx.head, headRaw);
  if (!base || !head) return;
  const report = (severity: Severity, message: string) => ctx.findings.push({ severity, location, message });

  if (union(base) || union(head)) {
    if (JSON.stringify(union(base)) !== JSON.stringify(union(head))) {
      report("warning", "a union (oneOf/anyOf/allOf) schema changed; check it by hand");
    }
    return;
  }
  if (typeChanged(base, head, direction, report)) return;

  compareNullability(base, head, direction, report);
  compareEnums(base, head, direction, report);
  if (direction === "request") compareRequestConstraints(base, head, report);

  if (typeOf(base) === "array" || typeOf(head) === "array") {
    compareSchemas(ctx, base.items, head.items, direction, `${location}[]`);
    return;
  }
  compareProperties(ctx, base, head, direction, location);
}

type Report = (severity: Severity, message: string) => void;

/** Reports a type change; true when there is one, since nothing beneath it is comparable. */
function typeChanged(base: Schema, head: Schema, direction: Direction, report: Report): boolean {
  const baseType = typeOf(base);
  const headType = typeOf(head);
  if (!baseType || !headType || baseType === headType) return false;
  // integer → number widens a request but breaks an integer-typed response field, and vice versa.
  const widensRequest = direction === "request" && baseType === "integer" && headType === "number";
  if (!widensRequest) report("breaking", `type changed from ${baseType} to ${headType}`);
  return true;
}

function compareNullability(base: Schema, head: Schema, direction: Direction, report: Report): void {
  if (direction === "response" && !isNullable(base) && isNullable(head)) {
    report("breaking", "response value can now be null");
  }
  if (direction === "request" && isNullable(base) && !isNullable(head)) {
    report("breaking", "request value may no longer be null");
  }
}

function compareEnums(base: Schema, head: Schema, direction: Direction, report: Report): void {
  const baseEnum = enumValues(base);
  const headEnum = enumValues(head);
  if (!baseEnum || !headEnum) {
    if (direction === "request" && !baseEnum && headEnum) report("breaking", "request value is now restricted to an enum");
    return;
  }
  const removed = baseEnum.filter((v) => !headEnum.includes(v));
  const added = headEnum.filter((v) => !baseEnum.includes(v));
  if (direction === "request" && removed.length > 0) {
    report("breaking", `request enum no longer accepts ${removed.map(String).join(", ")}`);
  }
  if (direction === "response" && added.length > 0) {
    report("warning", `response enum gained ${added.map(String).join(", ")}; strict enum decoding in older apps fails on it`);
  }
}

function compareRequestConstraints(base: Schema, head: Schema, report: Report): void {
  if (typeof head.maxLength === "number" && (typeof base.maxLength !== "number" || head.maxLength < base.maxLength)) {
    report("breaking", `request maxLength tightened to ${head.maxLength}`);
  }
  if (typeof head.minLength === "number" && head.minLength > (typeof base.minLength === "number" ? base.minLength : 0)) {
    report("breaking", `request minLength tightened to ${head.minLength}`);
  }
  if (typeof head.pattern === "string" && head.pattern !== base.pattern) {
    report("warning", "request pattern changed; check it does not refuse values older apps send");
  }
}

function compareProperties(ctx: CompareContext, base: Schema, head: Schema, direction: Direction, location: string): void {
  const baseProps = isObject(base.properties) ? base.properties : {};
  const headProps = isObject(head.properties) ? head.properties : {};
  const baseRequired = requiredSet(base);
  const headRequired = requiredSet(head);
  const at = (name: string, message: string) =>
    ctx.findings.push({ severity: "breaking", location: `${location}.${name}`, message });

  for (const [name, baseProp] of Object.entries(baseProps)) {
    const headProp = headProps[name];
    if (headProp === undefined) {
      if (direction === "response") at(name, "response field removed");
      continue;
    }
    if (direction === "response" && baseRequired.has(name) && !headRequired.has(name)) {
      at(name, "response field is no longer always present");
    }
    if (direction === "request" && !baseRequired.has(name) && headRequired.has(name)) {
      at(name, "request field is now required");
    }
    compareSchemas(ctx, baseProp, headProp, direction, `${location}.${name}`);
  }

  if (direction === "request") {
    for (const name of headRequired) {
      if (!(name in baseProps)) at(name, "new required request field");
    }
  }
}

function jsonSchemaOf(container: unknown): unknown {
  if (!isObject(container) || !isObject(container.content)) return undefined;
  const json = container.content["application/json"];
  return isObject(json) ? json.schema : undefined;
}

interface Parameter {
  name: string;
  in: string;
  required?: boolean;
  schema?: unknown;
}

function parametersOf(operation: Record<string, unknown>): Parameter[] {
  return (Array.isArray(operation.parameters) ? operation.parameters : []).filter(
    (p): p is Parameter => isObject(p) && typeof p.name === "string" && typeof p.in === "string",
  );
}

export function findBreakingChanges(base: OpenApiDoc, head: OpenApiDoc): Finding[] {
  const ctx: CompareContext = { base, head, findings: [], visited: new Set() };

  for (const [routePath, baseItem] of Object.entries(base.paths ?? {})) {
    for (const method of METHODS) {
      const baseOp = baseItem[method];
      if (!isObject(baseOp)) continue;
      const opName = `${method.toUpperCase()} ${routePath}`;
      const headOp = head.paths?.[routePath]?.[method];
      if (!isObject(headOp)) {
        ctx.findings.push({ severity: "breaking", location: opName, message: "operation removed" });
        continue;
      }

      // Responses: every success response the base promised must still match.
      const baseResponses = isObject(baseOp.responses) ? baseOp.responses : {};
      const headResponses = isObject(headOp.responses) ? headOp.responses : {};
      for (const [status, baseResponse] of Object.entries(baseResponses)) {
        if (!status.startsWith("2")) continue;
        const headResponse = headResponses[status];
        if (headResponse === undefined) {
          ctx.findings.push({ severity: "breaking", location: `${opName} response ${status}`, message: "success response removed" });
          continue;
        }
        compareSchemas(ctx, jsonSchemaOf(baseResponse), jsonSchemaOf(headResponse), "response", `${opName} response ${status}`);
      }

      // Request body.
      const baseBody = baseOp.requestBody;
      const headBody = headOp.requestBody;
      if (isObject(headBody)) {
        if (headBody.required === true && !(isObject(baseBody) && baseBody.required === true)) {
          ctx.findings.push({ severity: "breaking", location: `${opName} request`, message: "request body is now required" });
        }
        if (isObject(baseBody)) {
          compareSchemas(ctx, jsonSchemaOf(baseBody), jsonSchemaOf(headBody), "request", `${opName} request`);
        }
      }

      // Parameters: a new required one breaks every existing caller.
      const baseParams = parametersOf(baseOp);
      for (const headParam of parametersOf(headOp)) {
        const baseParam = baseParams.find((p) => p.name === headParam.name && p.in === headParam.in);
        const location = `${opName} ${headParam.in} parameter ${headParam.name}`;
        if (!baseParam) {
          if (headParam.required === true) {
            ctx.findings.push({ severity: "breaking", location, message: "new required parameter" });
          }
          continue;
        }
        if (headParam.required === true && baseParam.required !== true) {
          ctx.findings.push({ severity: "breaking", location, message: "parameter is now required" });
        }
        compareSchemas(ctx, baseParam.schema, headParam.schema, "request", location);
      }
    }
  }

  return ctx.findings;
}

export function formatFindings(findings: Finding[]): string {
  return findings.map((f) => `${f.severity.toUpperCase()}  ${f.location}: ${f.message}`).join("\n");
}
