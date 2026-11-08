/**
 * Startup and jank budgets for the Android app, checked against Macrobenchmark
 * results (mobile/baselineprofile; .github/workflows/mobile-performance.yml).
 *
 * A budget names a benchmark (the test method), a metric and a statistic:
 * `timeToInitialDisplayMs.median` for startup, `frameDurationCpuMs.P90` for
 * frame timing. Results come from Macrobenchmark's `*-benchmarkData.json`.
 */

import path from "node:path";

/** benchmark name → "metric.statistic" → the most it may be. */
export type Budgets = Record<string, Record<string, number>>;

interface MetricStats {
  readonly [statistic: string]: unknown;
}

export interface BenchmarkResult {
  readonly name: string;
  readonly metrics?: Record<string, MetricStats>;
  readonly sampledMetrics?: Record<string, MetricStats>;
}

export interface BenchmarkData {
  readonly benchmarks: readonly BenchmarkResult[];
}

export interface BudgetRow {
  readonly benchmark: string;
  readonly measure: string;
  readonly limit: number;
  /** Undefined when the benchmark did not run (e.g. skipped without a test account). */
  readonly actual?: number;
  readonly status: "pass" | "fail" | "skipped" | "missing";
}

function statistic(result: BenchmarkResult, measure: string): number | undefined {
  const dot = measure.lastIndexOf(".");
  const metric = measure.slice(0, dot);
  const stat = measure.slice(dot + 1);
  const value = (result.metrics?.[metric] ?? result.sampledMetrics?.[metric])?.[stat];
  return typeof value === "number" ? value : undefined;
}

/**
 * Checks every budget against the results. A benchmark that did not run is
 * skipped; one that ran without the budgeted metric is a failure ("missing"),
 * so a renamed metric cannot quietly pass.
 */
export function checkBudgets(budgets: Budgets, data: readonly BenchmarkData[]): BudgetRow[] {
  const byName = new Map<string, BenchmarkResult>();
  for (const file of data) for (const result of file.benchmarks) byName.set(result.name, result);
  const rows: BudgetRow[] = [];
  for (const [benchmark, limits] of Object.entries(budgets)) {
    const result = byName.get(benchmark);
    for (const [measure, limit] of Object.entries(limits)) {
      if (!result) {
        rows.push({ benchmark, measure, limit, status: "skipped" });
        continue;
      }
      const actual = statistic(result, measure);
      if (actual === undefined) rows.push({ benchmark, measure, limit, status: "missing" });
      else rows.push({ benchmark, measure, limit, actual, status: actual <= limit ? "pass" : "fail" });
    }
  }
  return rows;
}

const STATUS_LABEL: Record<BudgetRow["status"], string> = {
  pass: "✅ within budget",
  fail: "❌ over budget",
  skipped: "⏭️ did not run",
  missing: "❌ metric missing",
};

/** A Markdown table of the rows, for the job summary. */
export function formatBudgetTable(rows: readonly BudgetRow[]): string {
  const lines = ["| Benchmark | Measure | Budget | Result | |", "| --- | --- | ---: | ---: | --- |"];
  for (const row of rows) {
    const actual = row.actual === undefined ? "—" : row.actual.toFixed(1);
    lines.push(`| ${row.benchmark} | ${row.measure} | ${row.limit} | ${actual} | ${STATUS_LABEL[row.status]} |`);
  }
  return lines.join("\n") + "\n";
}

export function budgetsFailed(rows: readonly BudgetRow[]): boolean {
  return rows.some((row) => row.status === "fail" || row.status === "missing");
}

/**
 * [requested] resolved against [root], or null when it points outside it: the
 * CLI reads results only from inside the repository (CI passes a build
 * directory), never from wherever an argument leads.
 */
export function resolveInside(root: string, requested: string): string | null {
  const base = path.resolve(root);
  const resolved = path.resolve(base, requested);
  return resolved === base || resolved.startsWith(base + path.sep) ? resolved : null;
}
