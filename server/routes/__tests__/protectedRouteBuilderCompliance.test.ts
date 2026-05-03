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
});
