import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROUTE_DIRS = [
  path.resolve(process.cwd(), "server/routes"),
  path.resolve(process.cwd(), "server/routes/workouts"),
];

function collectTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "_helpers" || entry.name === "tests") {
        return [];
      }
      return collectTsFiles(fullPath);
    }
    if (!entry.isFile() || !entry.name.endsWith(".ts")) return [];
    return [fullPath];
  });
}

describe("protected route builder compliance", () => {
  it("rejects direct protected middleware stacking on mutating routes", () => {
    const offenders: string[] = [];
    const directProtectedMutationPattern = /router\.(post|patch|delete)\([\s\S]*?(protectedMutationGuards|isAuthenticated)/;

    for (const dir of ROUTE_DIRS) {
      for (const file of collectTsFiles(dir)) {
        const contents = readFileSync(file, "utf8");
        if (directProtectedMutationPattern.test(contents)) {
          offenders.push(path.relative(process.cwd(), file));
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  // W24 — every endpoint that burns AI budget must also gate on AI consent, so
  // a compromised/out-of-date client can't forward user data to a provider that
  // the user never consented to. Routes wire this two ways: the builder option
  // flags (`aiConsent: true, aiBudget: true`) or the explicit middleware array
  // (`middleware: [aiConsentCheck, aiBudgetCheck, ...]`). This statically asserts
  // the invariant `budget ⇒ consent` for both styles, across all route files.
  describe("AI consent coverage", () => {
    // Captures the options object (3rd arg) of each protectedPost/Patch/Delete
    // call. Options never contain nested braces (middleware uses [] and
    // validators are calls), so `{[^{}]*}` reliably delimits the object even
    // when the call spans multiple lines.
    const PROTECTED_OPTIONS = /protected(?:Post|Patch|Delete)\s*\(\s*router\s*,\s*"[^"]*"\s*,\s*(\{[^{}]*\})/g;
    const burnsBudget = (opts: string) => /aiBudget:\s*true/.test(opts) || /\baiBudgetCheck\b/.test(opts);
    const gatesConsent = (opts: string) => /aiConsent:\s*true/.test(opts) || /\baiConsentCheck\b/.test(opts);

    const budgeted: { file: string; opts: string }[] = [];
    for (const file of collectTsFiles(path.resolve(process.cwd(), "server/routes"))) {
      const contents = readFileSync(file, "utf8");
      for (const match of contents.matchAll(PROTECTED_OPTIONS)) {
        const opts = match[1];
        if (burnsBudget(opts)) {
          budgeted.push({ file: path.relative(process.cwd(), file), opts });
        }
      }
    }

    it("finds the AI-budgeted endpoints (guards against the scan silently matching nothing)", () => {
      expect(budgeted.length).toBeGreaterThanOrEqual(10);
    });

    it("requires aiConsent on every AI-budgeted endpoint", () => {
      const violations = budgeted
        .filter(({ opts }) => !gatesConsent(opts))
        .map(({ file, opts }) => `${file} :: ${opts.slice(0, 100)}`);
      expect(violations).toEqual([]);
    });
  });
});
