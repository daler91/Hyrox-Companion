/**
 * Sample JSON for every operation's request body and success response, built
 * from docs/openapi.json, for the Kotlin contract test
 * (mobile/core/src/commonTest/.../ApiContractTest.kt).
 *
 * Variants:
 *  - `min`: only required properties, required nullable ones as null;
 *  - `max`: every property present and non-null, one element per array;
 *  - `future` (responses only): `max` plus a property the schema does not
 *    have and every multi-value enum set to a value it does not list, i.e.
 *    what a newer server could send an installed build.
 * The test decodes every response variant, and decodes then re-encodes every
 * request variant expecting the same JSON back.
 *
 * Numbers are non-integral (1.5) wherever the schema says `number`, so a
 * round trip through Double compares equal; integers are whole.
 */
import type { OpenApiDocument } from "./generate";
import { operationName } from "./generate";

type Schema = Record<string, unknown>;
type Variant = "min" | "max" | "future";

const METHODS = ["get", "post", "put", "patch", "delete"] as const;
export const FUTURE_ENUM_VALUE = "zz_value_from_a_newer_server";
export const FUTURE_PROPERTY = "zzPropertyFromANewerServer";
const MAX_DEPTH = 24;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class SampleBuilder {
  constructor(private readonly schemas: Record<string, Schema>) {}

  private resolve(schema: Schema): Schema {
    const ref = typeof schema.$ref === "string" ? /^#\/components\/schemas\/(.+)$/.exec(schema.$ref)?.[1] : undefined;
    return ref ? this.resolve(this.schemas[ref] ?? {}) : schema;
  }

  private merged(schema: Schema): { properties: Record<string, Schema>; required: Set<string> } {
    const s = this.resolve(schema);
    const properties: Record<string, Schema> = {};
    const required = new Set<string>();
    for (const part of (Array.isArray(s.allOf) ? s.allOf : []) as Schema[]) {
      const inner = this.merged(part);
      Object.assign(properties, inner.properties);
      inner.required.forEach((r) => required.add(r));
    }
    if (isObject(s.properties)) Object.assign(properties, s.properties);
    if (Array.isArray(s.required)) (s.required as string[]).forEach((r) => required.add(r));
    return { properties, required };
  }

  private isNullable(schema: Schema): boolean {
    if (schema.nullable === true) return true;
    if (Array.isArray(schema.allOf)) return (schema.allOf as Schema[]).some((p) => p.nullable === true && p.$ref === undefined && p.properties === undefined);
    return false;
  }

  /** True for `allOf [ref, {nullable|description}]`: just the ref. */
  private singleRef(schema: Schema): Schema | undefined {
    if (!Array.isArray(schema.allOf)) return undefined;
    const parts = schema.allOf as Schema[];
    const refs = parts.filter((p) => typeof p.$ref === "string");
    const others = parts.filter((p) => typeof p.$ref !== "string");
    return refs.length === 1 && others.every((o) => o.properties === undefined && o.type === undefined) ? refs[0] : undefined;
  }

  /**
   * `depth` counts object and array nesting only; following a $ref or an
   * allOf wrapper does not deepen the JSON, so it does not count.
   */
  sample(schema: Schema, variant: Variant, depth = 0): unknown {
    if (depth > MAX_DEPTH) throw new Error("Sample nesting is deeper than MAX_DEPTH; is a schema recursive?");
    const single = this.singleRef(schema);
    if (single) return this.sample(single, variant, depth);
    const s = this.resolve(schema);
    if (s !== schema) return this.sample(s, variant, depth);

    if (Array.isArray(s.allOf)) return this.objectSample(this.merged(s), variant, depth);
    const union = (s.oneOf ?? s.anyOf) as Schema[] | undefined;
    if (Array.isArray(union) && union.length > 0) {
      // The generated type is raw JSON (or a number for numeric unions): any variant decodes.
      return this.sample(union[0], variant === "future" ? "max" : variant, depth);
    }
    if (Array.isArray(s.enum)) {
      // A nullable enum lists null among its values; samples use real ones.
      const values = (s.enum as unknown[]).filter((v) => v !== null);
      if (variant === "future" && s.type === "string" && values.length > 1) return FUTURE_ENUM_VALUE;
      return variant === "min" ? values[0] : values[values.length - 1];
    }
    switch (s.type) {
      case "string":
        if (s.format === "date-time") return "2026-11-07T10:15:30.000Z";
        if (s.format === "date") return "2026-11-07";
        if (s.format === "uri" || s.format === "url") return "https://fitai.coach/x";
        return variant === "min" ? "a" : "sample text";
      case "integer":
        return typeof s.minimum === "number" && s.minimum > 1 ? s.minimum : 1;
      case "number":
        return typeof s.minimum === "number" && s.minimum > 1.5 ? s.minimum + 0.5 : 1.5;
      case "boolean":
        return true;
      case "array":
        return variant === "min" ? [] : [this.sample(isObject(s.items) ? s.items : {}, variant, depth + 1)];
      default:
        break;
    }
    if (s.type === "object" || isObject(s.properties)) {
      const properties = isObject(s.properties) ? (s.properties as Record<string, Schema>) : {};
      if (Object.keys(properties).length === 0) {
        if (variant === "min") return {};
        const extra = s.additionalProperties;
        return { key: isObject(extra) && Object.keys(extra).length > 0 ? this.sample(extra, variant, depth + 1) : "value" };
      }
      return this.objectSample({ properties, required: new Set(Array.isArray(s.required) ? (s.required as string[]) : []) }, variant, depth);
    }
    // Any JSON value.
    return variant === "min" ? null : "any";
  }

  private objectSample(parts: { properties: Record<string, Schema>; required: Set<string> }, variant: Variant, depth: number): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [name, prop] of Object.entries(parts.properties)) {
      if (variant === "min") {
        if (!parts.required.has(name)) continue;
        out[name] = this.isNullable(prop) ? null : this.sample(prop, variant, depth + 1);
      } else {
        out[name] = this.sample(prop, variant, depth + 1);
      }
    }
    if (variant === "future") out[FUTURE_PROPERTY] = { added: true };
    return out;
  }
}

export interface OperationSamples {
  request?: { min: unknown; max: unknown };
  response?: { min: unknown; max: unknown; future: unknown };
}

/** Samples per operation name, for operations with a JSON (or event-stream) body. */
export function buildSamples(doc: OpenApiDocument): Map<string, OperationSamples> {
  const builder = new SampleBuilder(doc.components?.schemas ?? {});
  const samples = new Map<string, OperationSamples>();
  for (const routePath of Object.keys(doc.paths ?? {}).sort()) {
    for (const method of METHODS) {
      const op = doc.paths?.[routePath]?.[method];
      if (!isObject(op)) continue;
      const entry: OperationSamples = {};
      const body = isObject(op.requestBody) && isObject(op.requestBody.content) ? op.requestBody.content["application/json"] : undefined;
      if (isObject(body) && isObject(body.schema)) {
        entry.request = { min: builder.sample(body.schema, "min"), max: builder.sample(body.schema, "max") };
      }
      const responses = isObject(op.responses) ? op.responses : {};
      for (const status of Object.keys(responses).filter((s) => s.startsWith("2")).sort()) {
        const content = isObject(responses[status]) ? (responses[status] as Schema).content : undefined;
        if (!isObject(content)) continue;
        const chosen = isObject(content["application/json"]) ? content["application/json"] : content["text/event-stream"];
        if (isObject(chosen) && isObject(chosen.schema)) {
          entry.response = {
            min: builder.sample(chosen.schema, "min"),
            max: builder.sample(chosen.schema, "max"),
            future: builder.sample(chosen.schema, "future"),
          };
          break;
        }
      }
      if (entry.request || entry.response) samples.set(operationName(method, routePath), entry);
    }
  }
  return samples;
}
