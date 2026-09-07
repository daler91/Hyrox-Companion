import { execFileSync } from 'node:child_process';

import { parseBenchmarkRows } from './timelineBenchmarkFormat';

/**
 * Perf guard over `sortAndWindowTimelineEntries`. Runs the benchmark in a child
 * process — a fresh V8 heap, so the per-case heap deltas mean something — and
 * asserts each case stayed inside its budget. The results are read from the
 * benchmark's machine-readable line; see ./timelineBenchmarkFormat for why.
 *
 * Not wired into any workflow. The thresholds below are absolute milliseconds
 * measured on a developer machine, so running this on shared CI hardware would
 * report noise as regressions. It stays a local check until the budgets are
 * expressed relative to a baseline measured in the same run.
 */

const safePath = '/usr/bin:/bin';
const out = execFileSync(
  process.execPath,
  ['node_modules/tsx/dist/cli.mjs', 'script/timeline-benchmark.ts'],
  { encoding: 'utf8', env: { ...process.env, PATH: safePath } },
);
process.stdout.write(out);

const rows = parseBenchmarkRows(out);

const thresholds: Record<string, { maxMs: number; maxHeapMb: number }> = {
  medium: { maxMs: 180, maxHeapMb: 30 },
  high: { maxMs: 700, maxHeapMb: 90 },
  'high-offset': { maxMs: 700, maxHeapMb: 90 },
  unbounded: { maxMs: 250, maxHeapMb: 35 },
};

for (const [name, t] of Object.entries(thresholds)) {
  const row = rows.find((r) => r.name === name);
  if (!row) throw new Error(`missing benchmark row: ${name}`);
  // Parity first: a fast run that returns the wrong window is not a pass.
  if (row.parity !== true) throw new Error(`${name} parity check failed`);
  if (!Number.isFinite(row.ms) || !Number.isFinite(row.heapMb)) {
    throw new TypeError(
      `${name} benchmark reported no measurement (ms=${row.ms}, heapMb=${row.heapMb})`,
    );
  }
  if (row.ms > t.maxMs) throw new Error(`${name} latency ${row.ms}ms exceeded ${t.maxMs}ms`);
  if (row.heapMb > t.maxHeapMb) throw new Error(`${name} heap ${row.heapMb}MB exceeded ${t.maxHeapMb}MB`);
}

console.log('timeline benchmark guard passed');
