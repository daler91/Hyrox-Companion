import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { type BenchmarkData, type Budgets, budgetsFailed, checkBudgets, formatBudgetTable } from "./budgets";

const startup: BenchmarkData = {
  benchmarks: [
    {
      name: "coldStartupWithBaselineProfile",
      metrics: { timeToInitialDisplayMs: { minimum: 610, median: 702.4, maximum: 880, runs: [702.4] } },
    },
    {
      name: "browsingTabs",
      sampledMetrics: { frameDurationCpuMs: { P50: 6.1, P90: 14.2, P95: 19.8, P99: 31, runs: [[6.1]] } },
    },
  ],
};

describe("checkBudgets", () => {
  it("passes a measure at or under its budget and fails one over it", () => {
    const budgets: Budgets = {
      coldStartupWithBaselineProfile: { "timeToInitialDisplayMs.median": 800 },
      browsingTabs: { "frameDurationCpuMs.P90": 16, "frameDurationCpuMs.P95": 16 },
    };
    const rows = checkBudgets(budgets, [startup]);
    expect(rows.map((row) => [row.benchmark, row.measure, row.actual, row.status])).toEqual([
      ["coldStartupWithBaselineProfile", "timeToInitialDisplayMs.median", 702.4, "pass"],
      ["browsingTabs", "frameDurationCpuMs.P90", 14.2, "pass"],
      ["browsingTabs", "frameDurationCpuMs.P95", 19.8, "fail"],
    ]);
    expect(budgetsFailed(rows)).toBe(true);
  });

  it("skips a benchmark that did not run, without failing", () => {
    const rows = checkBudgets({ coldStartupWithoutProfile: { "timeToInitialDisplayMs.median": 2000 } }, [startup]);
    expect(rows).toEqual([
      { benchmark: "coldStartupWithoutProfile", measure: "timeToInitialDisplayMs.median", limit: 2000, status: "skipped" },
    ]);
    expect(budgetsFailed(rows)).toBe(false);
  });

  it("fails a benchmark that ran without the budgeted metric, so a rename cannot pass quietly", () => {
    const rows = checkBudgets({ coldStartupWithBaselineProfile: { "timeToFullDisplayMs.median": 1000 } }, [startup]);
    expect(rows[0]?.status).toBe("missing");
    expect(budgetsFailed(rows)).toBe(true);
  });

  it("reads results spread over several files", () => {
    const other: BenchmarkData = {
      benchmarks: [{ name: "coldStartupWithoutProfile", metrics: { timeToInitialDisplayMs: { median: 950 } } }],
    };
    const rows = checkBudgets({ coldStartupWithoutProfile: { "timeToInitialDisplayMs.median": 1000 } }, [startup, other]);
    expect(rows[0]).toMatchObject({ actual: 950, status: "pass" });
  });
});

describe("formatBudgetTable", () => {
  it("renders one Markdown row per measure", () => {
    const table = formatBudgetTable([
      { benchmark: "browsingTabs", measure: "frameDurationCpuMs.P90", limit: 16, actual: 14.25, status: "pass" },
      { benchmark: "browsingTabs", measure: "frameDurationCpuMs.P95", limit: 16, status: "skipped" },
    ]);
    expect(table).toContain("| browsingTabs | frameDurationCpuMs.P90 | 16 | 14.3 | ✅ within budget |");
    expect(table).toContain("| browsingTabs | frameDurationCpuMs.P95 | 16 | — | ⏭️ did not run |");
  });
});

describe("the committed budgets", () => {
  it("name only benchmarks StartupBenchmark defines, each with metric.statistic measures", () => {
    const root = path.resolve(import.meta.dirname, "../..");
    const budgets = JSON.parse(readFileSync(path.join(root, "mobile/baselineprofile/budgets.json"), "utf8")) as Budgets;
    const source = readFileSync(
      path.join(root, "mobile/baselineprofile/src/main/kotlin/com/fitai/coach/baselineprofile/StartupBenchmark.kt"),
      "utf8",
    );
    for (const [benchmark, limits] of Object.entries(budgets)) {
      expect(source).toContain(`fun ${benchmark}()`);
      for (const measure of Object.keys(limits)) expect(measure).toMatch(/^[A-Za-z]+\.(median|minimum|maximum|P50|P90|P95|P99)$/);
    }
  });
});
