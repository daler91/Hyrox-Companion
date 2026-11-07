import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FIXTURES_DIR, loadSuites, renderSuite } from "./build";

describe("golden fixtures for the Kotlin ports", () => {
  it("are what the TypeScript originals produce today (run `pnpm mobile:fixtures` after changing shared/)", async () => {
    const suites = await loadSuites();
    const committed = existsSync(FIXTURES_DIR) ? readdirSync(FIXTURES_DIR).sort() : [];

    expect(committed).toEqual(suites.map((s) => `${s.name}.json`).sort());
    const stale = suites.filter((s) => readFileSync(path.join(FIXTURES_DIR, `${s.name}.json`), "utf8") !== renderSuite(s));
    expect(stale.map((s) => s.name)).toEqual([]);
  });

  it("give every suite cases", async () => {
    const empty = (await loadSuites()).filter((s) => s.cases.length === 0).map((s) => s.name);
    expect(empty).toEqual([]);
  });
});
