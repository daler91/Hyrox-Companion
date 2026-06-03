/**
 * Accuracy backtest: OLD hand-guessed seeds vs NEW data-derived benchmarks.
 *
 * Splits the real results 80/20 BEFORE aggregating (so we never test on rows we
 * fit on), builds the NEW benchmarks from the train split, then for every held-
 * out result compares the cohort-only predicted finish against the actual:
 *   - OLD = legacy seed station + flat run benchmarks, NO transition (the prior
 *     deterministic behavior — the bug being fixed).
 *   - NEW = cohort median stations + per-leg run curve + median transition.
 *
 * Reports MAE, median absolute error, and mean SIGNED error (bias). The OLD path
 * should show a large negative bias ≈ −(real transition); the NEW path ≈ 0.
 *
 * Run: pnpm tsx script/race-benchmarks/backtest.ts   (no API key needed)
 */
import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "csv-parse";

import { cohortKey, HYROX_STATION_ORDER, RACE_RUN_LEGS } from "../../shared/raceConstants";
import {
  LEGACY_RUN_KM_BENCHMARK_SECONDS,
  LEGACY_STATION_BENCHMARK_SECONDS,
} from "../../shared/raceSpec";
import { aggregate, type CohortBenchmark, type ParsedRace, parseRaceRow, percentile } from "./lib";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "../..");

function log(...args: unknown[]): void {
  console.log("[race-backtest]", ...args);
}

function predictNew(benchmarks: Record<string, CohortBenchmark>, race: ParsedRace): number | null {
  const ageKey = race.ageBand ? cohortKey(race.division, race.gender, race.ageBand) : null;
  const b = (ageKey && benchmarks[ageKey]) || benchmarks[cohortKey(race.division, race.gender)];
  if (!b) return null;
  const stationSum = HYROX_STATION_ORDER.reduce((t, s) => t + b.stationP50Seconds[s], 0);
  const runSum = b.runLegP50Seconds.reduce((t, v) => t + v, 0);
  return stationSum + runSum + b.transitionTotalP50Seconds;
}

/** Pre-change behavior: legacy seeds, one flat run pace, and NO transition. */
function predictOld(race: ParsedRace): number {
  const stationSum = HYROX_STATION_ORDER.reduce(
    (t, s) => t + LEGACY_STATION_BENCHMARK_SECONDS[race.division][race.gender][s],
    0,
  );
  const runSum = RACE_RUN_LEGS * LEGACY_RUN_KM_BENCHMARK_SECONDS[race.division][race.gender];
  return stationSum + runSum;
}

interface ErrorStats {
  n: number;
  maeSeconds: number;
  medianAbsErrorSeconds: number;
  meanSignedErrorSeconds: number;
}

function errorStats(predicted: number[], actual: number[]): ErrorStats {
  const signed = predicted.map((p, i) => p - actual[i]);
  const abs = signed.map((e) => Math.abs(e));
  const sortedAbs = [...abs].sort((a, b) => a - b);
  const mean = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / xs.length;
  return {
    n: predicted.length,
    maeSeconds: Math.round(mean(abs)),
    medianAbsErrorSeconds: Math.round(percentile(sortedAbs, 50)),
    meanSignedErrorSeconds: Math.round(mean(signed)),
  };
}

function fmt(stats: ErrorStats): string {
  const m = (s: number) => `${s >= 0 ? "+" : "−"}${Math.abs(Math.round(s / 6) / 10)}min`;
  return `n=${stats.n} · MAE=${stats.maeSeconds}s (${Math.round(stats.maeSeconds / 6) / 10}min) · medAbs=${stats.medianAbsErrorSeconds}s · bias=${m(stats.meanSignedErrorSeconds)}`;
}

async function main(): Promise<void> {
  const csvPath = resolve(repoRoot, "hyrox_results.csv");
  log(`Reading ${csvPath}`);

  const train: ParsedRace[] = [];
  const test: ParsedRace[] = [];
  let i = 0;
  const parser = createReadStream(csvPath).pipe(
    parse({ columns: true, skip_empty_lines: true, relax_column_count: true, trim: true }),
  );
  for await (const record of parser) {
    const parsed = parseRaceRow(record as Record<string, string>);
    if (!parsed) continue;
    // Deterministic 80/20 split before aggregation (every 5th row → test).
    if (i % 5 === 0) test.push(parsed);
    else train.push(parsed);
    i++;
  }
  log(`train=${train.length} test=${test.length}`);

  const { benchmarks } = aggregate(train);

  const oldPred: number[] = [];
  const newPred: number[] = [];
  const actual: number[] = [];
  // Per-main-cohort buckets for a breakdown table.
  const cohorts = ["open|male", "open|female", "pro|male", "pro|female"] as const;
  const byCohort: Record<string, { old: number[]; neu: number[]; act: number[] }> = {};
  for (const c of cohorts) byCohort[c] = { old: [], neu: [], act: [] };

  for (const race of test) {
    const np = predictNew(benchmarks, race);
    if (np == null) continue;
    const op = predictOld(race);
    oldPred.push(op);
    newPred.push(np);
    actual.push(race.totalSeconds);
    const key = cohortKey(race.division, race.gender);
    byCohort[key].old.push(op);
    byCohort[key].neu.push(np);
    byCohort[key].act.push(race.totalSeconds);
  }

  const oldStats = errorStats(oldPred, actual);
  const newStats = errorStats(newPred, actual);
  const improvement = Math.round((1 - newStats.maeSeconds / oldStats.maeSeconds) * 1000) / 10;

  log(`OLD seeds : ${fmt(oldStats)}`);
  log(`NEW data  : ${fmt(newStats)}`);
  log(`MAE improvement: ${improvement}%`);

  const lines = [
    "# HYROX predictor accuracy backtest — OLD seeds vs NEW data",
    "",
    `Held-out test rows: ${actual.length} (80/20 split, fit on ${train.length}).`,
    "Cohort-only prediction (no personal training logs) vs actual finish time.",
    "",
    "| Model | n | MAE | median abs err | mean signed err (bias) |",
    "| --- | ---: | ---: | ---: | ---: |",
    `| OLD seeds (no transition) | ${oldStats.n} | ${oldStats.maeSeconds}s | ${oldStats.medianAbsErrorSeconds}s | ${oldStats.meanSignedErrorSeconds}s |`,
    `| NEW data (curve + transition) | ${newStats.n} | ${newStats.maeSeconds}s | ${newStats.medianAbsErrorSeconds}s | ${newStats.meanSignedErrorSeconds}s |`,
    "",
    `**MAE improvement: ${improvement}%.** Adding the real transition time and per-leg run curve cuts the OLD model's large negative bias (it omitted transition entirely) by most of its magnitude. The residual NEW bias is the median-vs-mean skew of a cohort-only point prediction — the live predictor further personalizes with the athlete's own logs + AI, which this reference-layer backtest deliberately excludes.`,
    "",
    "## By cohort (MAE)",
    "",
    "| Cohort | n | OLD MAE | NEW MAE |",
    "| --- | ---: | ---: | ---: |",
  ];
  for (const c of cohorts) {
    const b = byCohort[c];
    if (b.act.length === 0) continue;
    const o = errorStats(b.old, b.act);
    const nu = errorStats(b.neu, b.act);
    lines.push(`| ${c} | ${o.n} | ${o.maeSeconds}s | ${nu.maeSeconds}s |`);
  }
  lines.push("");

  const outDir = resolve(__dirname, "output");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "backtest-report.md"), lines.join("\n"));
  writeFileSync(
    resolve(outDir, "backtest-report.json"),
    JSON.stringify({ old: oldStats, new: newStats, improvementPct: improvement }, null, 2),
  );
  log(`Wrote ${resolve(outDir, "backtest-report.md")}`);
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
