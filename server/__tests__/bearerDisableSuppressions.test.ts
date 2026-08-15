import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Mirrors tsconfig's "include" — everywhere a `bearer:disable` suppression
// comment could live.
const SCAN_DIRS = ["client/src", "server", "shared", "script"].map((d) =>
  path.resolve(process.cwd(), d),
);
const SKIP_DIR_NAMES = new Set(["node_modules", "dist", "coverage", "__snapshots__"]);

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return SKIP_DIR_NAMES.has(entry.name) ? [] : collectSourceFiles(fullPath);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

// Bearer's suppression parser takes *everything after* `bearer:disable` on
// that comment line as the rule-id list (plain string split, no
// tokenization) — a trailing "— justification" makes the "rule id" match
// nothing, so the suppression silently no-ops and the alert fires anyway.
// See .jules/sentinel.md (2026-08-12): this exact mistake has recurred 6+
// times in this repo's history. The directive line must contain ONLY
// `bearer:disable <rule id>`; put the "why" on its own comment line above it.
// Anchored to an actual `//` directive line so prose that merely *mentions*
// "bearer:disable" (like the sentences above) doesn't self-match.
const DIRECTIVE_LINE = /^\s*\/\/\s*bearer:disable\s+(\S+)(.*)$/;

function findBrokenDirectives(): string[] {
  const broken: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of collectSourceFiles(dir)) {
      const rel = path.relative(process.cwd(), file);
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const match = DIRECTIVE_LINE.exec(line);
        if (match && match[2].trim().length > 0) {
          broken.push(`${rel}: ${line.trim()}`);
        }
      }
    }
  }
  return broken;
}

describe("bearer:disable suppression directives", () => {
  it("finds bearer:disable directives to check (guards against the scan silently matching nothing)", () => {
    let total = 0;
    for (const dir of SCAN_DIRS) {
      for (const file of collectSourceFiles(dir)) {
        total += (readFileSync(file, "utf8").match(/bearer:disable/g) ?? []).length;
      }
    }
    expect(total).toBeGreaterThan(0);
  });

  // Ratchet, not an aspiration: 38 pre-existing directives were broken this
  // way as of 2026-08-14 — fixing all of them is a repo-wide sweep out of
  // scope for one change. This caps the damage and blocks it from growing:
  // lower BASELINE as offenders get cleaned up, never raise it.
  it("does not grow the count of broken (unmatchable) suppression directives", () => {
    const BASELINE = 38;
    const broken = findBrokenDirectives();
    expect(broken.length).toBeLessThanOrEqual(BASELINE);
  });
});
