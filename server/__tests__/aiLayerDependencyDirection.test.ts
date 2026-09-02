import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SERVER_ROOT = path.resolve(__dirname, "..");
const AI_ROOT = path.join(SERVER_ROOT, "ai");
const GEMINI_ROOT = path.join(SERVER_ROOT, "gemini");

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(fullPath);
    if (!entry.name.endsWith(".ts")) return [];
    if (entry.name.endsWith(".test.ts") || entry.name === "testHelpers.ts") return [];
    return [fullPath];
  });
}

// Module specifiers from static imports, `export ... from` re-exports and
// dynamic `import("...")` calls.
const MODULE_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;

function resolvesInto(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * A2 (docs/CODEBASE_ANALYSIS_2026-08-31.md): the provider-agnostic AI layer
 * used to import its retry/timeout core from server/gemini, which imported
 * back from server/ai. The core now lives in server/ai (retry.ts,
 * circuitBreaker.ts, geminiSdk.ts) and the dependency runs gemini -> ai only.
 * This test keeps it that way: nothing under server/ai may resolve an import
 * into server/gemini. Only resolved paths are checked, so files inside
 * server/ai that happen to be named after a provider are not violations.
 */
describe("server/ai dependency direction (A2)", () => {
  const files = collectSourceFiles(AI_ROOT);

  it("scans the provider layer (guards against the scan silently matching nothing)", () => {
    expect(files).toContain(path.join(AI_ROOT, "providers", "gemini.ts"));
    expect(files).toContain(path.join(AI_ROOT, "retry.ts"));
  });

  it("never imports from server/gemini", () => {
    const offenders: string[] = [];
    let specifiers = 0;
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(MODULE_SPECIFIER)) {
        specifiers += 1;
        const specifier = match[1];
        if (!specifier.startsWith(".")) continue;
        const resolved = path.resolve(path.dirname(file), specifier);
        if (resolvesInto(GEMINI_ROOT, resolved)) {
          offenders.push(`${path.relative(SERVER_ROOT, file)} -> ${specifier}`);
        }
      }
    }
    expect(specifiers).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
