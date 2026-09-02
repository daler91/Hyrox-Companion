import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ErrorCode } from "../errors";

const SERVER_ROOT = path.resolve(__dirname, "..");
const SKIP_DIR_NAMES = new Set(["node_modules", "dist", "coverage", "__tests__", "__snapshots__"]);

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return SKIP_DIR_NAMES.has(entry.name) ? [] : collectSourceFiles(fullPath);
    }
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [fullPath] : [];
  });
}

// `code: "SOME_CODE"` — the shape every JSON error body in this repo uses.
const EMITTED_CODE = /\bcode:\s*["']([A-Z][A-Z0-9_]*)["']/g;

/**
 * Every error code a route emits must be a member of ErrorCode (A6). The enum
 * is the catalogue clients match against; a code that exists only as a string
 * literal in one handler is invisible there and one typo away from silently
 * breaking whatever matched on it.
 */
describe("API error codes", () => {
  it("are all members of ErrorCode", () => {
    const known = new Set<string>(Object.values(ErrorCode));
    const unknown: string[] = [];
    for (const file of collectSourceFiles(SERVER_ROOT)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(EMITTED_CODE)) {
        const code = match[1];
        if (!known.has(code)) unknown.push(`${path.relative(SERVER_ROOT, file)}: ${code}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it("finds emitted codes to check (guards against the scan silently matching nothing)", () => {
    let total = 0;
    for (const file of collectSourceFiles(SERVER_ROOT)) {
      total += [...readFileSync(file, "utf8").matchAll(EMITTED_CODE)].length;
    }
    expect(total).toBeGreaterThan(20);
  });
});
