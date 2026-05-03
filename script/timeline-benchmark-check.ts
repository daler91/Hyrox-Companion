import { execFileSync } from 'node:child_process';

const safePath = '/usr/bin:/bin';
const out = execFileSync(
  process.execPath,
  ['node_modules/tsx/dist/cli.mjs', 'script/timeline-benchmark.ts'],
  { encoding: 'utf8', env: { ...process.env, PATH: safePath } },
);
process.stdout.write(out);

const lines = out.split('\n').filter((l) => l.includes("│ '") && l.includes('│'));
const parsed = lines.map((line) => {
  const cells = line.split('│').map((c) => c.trim()).filter(Boolean);
  const ms = Number(cells[cells.length - 2]);
  const heapMb = Number(cells[cells.length - 1]);
  return {
    name: cells[1]?.replaceAll("'", ''),
    parity: cells[cells.length - 3],
    ms,
    heapMb,
  };
});

const thresholds: Record<string, { maxMs: number; maxHeapMb: number }> = {
  medium: { maxMs: 180, maxHeapMb: 30 },
  high: { maxMs: 700, maxHeapMb: 90 },
  'high-offset': { maxMs: 700, maxHeapMb: 90 },
  unbounded: { maxMs: 250, maxHeapMb: 35 },
};

for (const [name, t] of Object.entries(thresholds)) {
  const row = parsed.find((p) => p.name === name);
  if (!row) throw new Error(`missing benchmark row: ${name}`);
  if (row.parity !== 'true') throw new Error(`${name} parity check failed`);
  if (!Number.isFinite(row.ms) || !Number.isFinite(row.heapMb)) {
    throw new TypeError(`${name} benchmark output parse failure (ms=${row.ms}, heapMb=${row.heapMb})`);
  }
  if (row.ms > t.maxMs) throw new Error(`${name} latency ${row.ms}ms exceeded ${t.maxMs}ms`);
  if (row.heapMb > t.maxHeapMb) throw new Error(`${name} heap ${row.heapMb}MB exceeded ${t.maxHeapMb}MB`);
}

console.log('timeline benchmark guard passed');
