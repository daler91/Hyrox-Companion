import { execSync } from 'node:child_process';

const out = execSync('pnpm -s tsx script/timeline-benchmark.ts', { encoding: 'utf8' });
process.stdout.write(out);

const lines = out.split('\n').filter((l) => l.includes("│ '") && l.includes('│'));
const parsed = lines.map((line) => {
  const cells = line.split('│').map((c) => c.trim()).filter(Boolean);
  return {
    name: cells[1]?.replaceAll("'", ''),
    parity: cells[5],
    ms: Number(cells[6]),
    heapMb: Number(cells[7]),
  };
});

const thresholds: Record<string,{maxMs:number;maxHeapMb:number}> = {
  medium: { maxMs: 180, maxHeapMb: 30 },
  high: { maxMs: 700, maxHeapMb: 90 },
  'high-offset': { maxMs: 700, maxHeapMb: 90 },
};

for (const [name, t] of Object.entries(thresholds)) {
  const row = parsed.find((p) => p.name === name);
  if (!row) throw new Error(`missing benchmark row: ${name}`);
  if (row.parity !== 'true') throw new Error(`${name} parity check failed`);
  if (row.ms > t.maxMs) throw new Error(`${name} latency ${row.ms}ms exceeded ${t.maxMs}ms`);
  if (row.heapMb > t.maxHeapMb) throw new Error(`${name} heap ${row.heapMb}MB exceeded ${t.maxHeapMb}MB`);
}

console.log('timeline benchmark guard passed');
