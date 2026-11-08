/**
 * Checks Macrobenchmark results against mobile/baselineprofile/budgets.json.
 *
 *   pnpm mobile:perf-budgets <directory with *-benchmarkData.json>
 *
 * Prints a Markdown table (CI appends it to the job summary) and exits 1 when
 * a budget is exceeded or a budgeted metric is missing.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { type BenchmarkData, type Budgets, budgetsFailed, checkBudgets, formatBudgetTable } from "./budgets";

const ROOT = path.resolve(import.meta.dirname, "../..");
const BUDGETS = path.join(ROOT, "mobile/baselineprofile/budgets.json");

function findResults(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith("benchmarkData.json"))
    .map((file) => path.join(directory, file));
}

const directory = process.argv[2];
if (!directory) {
  process.stderr.write("usage: pnpm mobile:perf-budgets <results directory>\n");
  process.exit(2);
}
const files = findResults(directory);
if (files.length === 0) {
  process.stderr.write(`No *-benchmarkData.json under ${directory}\n`);
  process.exit(1);
}
const budgets = JSON.parse(readFileSync(BUDGETS, "utf8")) as Budgets;
const data = files.map((file) => JSON.parse(readFileSync(file, "utf8")) as BenchmarkData);
const rows = checkBudgets(budgets, data);
process.stdout.write(formatBudgetTable(rows));
if (budgetsFailed(rows)) process.exit(1);
