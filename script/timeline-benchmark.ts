import { performance } from 'node:perf_hooks';

import type { TimelineEntry } from '@shared/schema';
import { sortAndWindowTimelineEntries } from '../server/storage/timelineWindow';

type Entry = Pick<TimelineEntry, 'id' | 'date' | 'type'>;

function randomDate(start: string, spanDays: number, seed: number) {
  const base = new Date(`${start}T00:00:00Z`).getTime();
  const n = (seed * 9301 + 49297) % 233280;
  const day = Math.floor((n / 233280) * spanDays);
  return new Date(base + day * 86400000).toISOString().slice(0, 10);
}

function buildDataset(plannedCount: number, loggedCount: number) {
  const scheduled: Entry[] = [];
  const standalone: Entry[] = [];
  for (let i = 0; i < plannedCount; i++) scheduled.push({ id: `p-${i}`, date: randomDate('2024-01-01', 900, i + 17), type: 'planned' });
  for (let i = 0; i < loggedCount; i++) standalone.push({ id: `l-${i}`, date: randomDate('2024-01-01', 900, i + 71), type: 'logged' });
  return { scheduled, standalone };
}

function legacySortAndSlice(entries: Entry[], limit?: number, offset?: number) {
  const copy = [...entries];
  copy.sort((a, b) => b.date.localeCompare(a.date));
  if (limit === undefined) return copy;
  const start = offset || 0;
  return copy.slice(start, start + limit);
}

function runCase(name: string, planned: number, logged: number, limit?: number, offset?: number) {
  const mem0 = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const data = buildDataset(planned, logged);
  const candidates = [...data.scheduled, ...data.standalone];

  const legacy = legacySortAndSlice(candidates, limit, offset);
  const current = sortAndWindowTimelineEntries(candidates as TimelineEntry[], limit, offset) as Entry[];

  const parity = JSON.stringify(legacy) === JSON.stringify(current);
  const t1 = performance.now();
  const mem1 = process.memoryUsage().heapUsed;

  return { name, planned, logged, limit: limit ?? 'none', offset: offset ?? 0, returned: current.length, parity, ms: +(t1 - t0).toFixed(2), heapMb: +((mem1 - mem0) / 1024 / 1024).toFixed(2) };
}

const cases = [
  runCase('medium', 10000, 10000, 50, 0),
  runCase('high', 50000, 50000, 50, 0),
  runCase('high-offset', 50000, 50000, 50, 5000),
  runCase('unbounded', 10000, 10000),
];

console.table(cases);
