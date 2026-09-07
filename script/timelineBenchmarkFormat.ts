/**
 * The wire format between `timeline-benchmark.ts` (which measures) and
 * `timeline-benchmark-check.ts` (which asserts budgets). Its own module because
 * the benchmark runs the whole workload at import time: importing it from the
 * checker just to reach a shared constant would run the benchmark twice, once
 * in-process and once in the child.
 */

/** Prefix of the single machine-readable line the benchmark prints. */
export const BENCHMARK_RESULT_PREFIX = "timeline-benchmark-json:";

export interface BenchmarkRow {
  name: string;
  planned: number;
  logged: number;
  limit: number | "none";
  offset: number;
  returned: number;
  parity: boolean;
  ms: number;
  heapMb: number;
}

/**
 * Pull the results out of the benchmark's stdout.
 *
 * The checker used to read the `console.table` box-drawing output instead,
 * slicing cells out of `│`-delimited lines by counting columns from the right —
 * so adding a column, renaming one, or a value long enough to wrap silently
 * produced NaN or the wrong field, and `parity` had to be compared against the
 * STRING "true" because that is what the table rendered. A formatting change is
 * not a performance regression, and the guard should not fail as though it were.
 */
export function parseBenchmarkRows(stdout: string): BenchmarkRow[] {
  // Last match wins: the human-readable table is printed first and the child's
  // output is echoed, so a later line is the more complete one.
  const line = stdout
    .split("\n")
    .reverse()
    .find((l) => l.startsWith(BENCHMARK_RESULT_PREFIX));
  if (!line) {
    throw new Error(
      `benchmark produced no "${BENCHMARK_RESULT_PREFIX}" line — did it fail before finishing?`,
    );
  }
  const parsed: unknown = JSON.parse(line.slice(BENCHMARK_RESULT_PREFIX.length));
  if (!Array.isArray(parsed)) {
    throw new TypeError("benchmark results line did not hold an array of rows");
  }
  return parsed as BenchmarkRow[];
}
