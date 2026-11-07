import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { FixtureSuite } from "./types";

export const SUITES_DIR = path.join(import.meta.dirname, "suites");
export const FIXTURES_DIR = path.resolve(import.meta.dirname, "../../mobile/core/src/commonTest/resources/fixtures");

/** JSON for a fixture file; NaN and infinities become strings (JSON has no form for them). */
export function fixtureJson(value: unknown): string {
  const replacer = (_key: string, v: unknown) => {
    if (typeof v === "number" && !Number.isFinite(v)) return Number.isNaN(v) ? "NaN" : v > 0 ? "Infinity" : "-Infinity";
    return v;
  };
  return `${JSON.stringify(value, replacer, 2)}\n`;
}

/** Every suite exported by a file in suites/ (any export that is an array of suites, or a suite). */
export async function loadSuites(): Promise<FixtureSuite[]> {
  const files = readdirSync(SUITES_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .sort();
  const suites: FixtureSuite[] = [];
  for (const file of files) {
    const mod = (await import(pathToFileURL(path.join(SUITES_DIR, file)).href)) as Record<string, unknown>;
    for (const value of Object.values(mod)) {
      const list = Array.isArray(value) ? value : [value];
      for (const candidate of list) {
        if (isSuite(candidate)) suites.push(candidate);
      }
    }
  }
  const names = suites.map((s) => s.name);
  const duplicate = names.find((n, i) => names.indexOf(n) !== i);
  if (duplicate) throw new Error(`Two fixture suites are named ${duplicate}`);
  return suites.sort((a, b) => a.name.localeCompare(b.name));
}

function isSuite(value: unknown): value is FixtureSuite {
  return typeof value === "object" && value !== null && "name" in value && "run" in value && "cases" in value;
}

/** The fixture file content for a suite: its cases run through the TypeScript original. */
export function renderSuite(s: FixtureSuite): string {
  const cases = s.cases.map((input) => ({ input, output: s.run(input) }));
  return fixtureJson({ suite: s.name, description: s.description, cases });
}
