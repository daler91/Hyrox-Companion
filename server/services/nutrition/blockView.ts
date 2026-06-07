import type { BlockViewPoint } from "@shared/schema";

import { type LogEntryWithFood, roundMacros, sumNutrition } from "./rollup";

interface DateRange {
  from: string;
  to: string;
}

/** Just the per-day UTSS read off `calculateTrainingLoad(...).dailyLoads`. */
type DailyUtss = { date: string; utss: number };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Iterate calendar days inclusively from `from` to `to` on the UTC grain
 * (YYYY-MM-DD) — matching `workoutLogs.date` / `food_log_entries.logDate`, so a
 * DST transition can never shift a day bucket. Yields nothing for an inverted or
 * unparseable range.
 */
function* eachDate(from: string, to: string): Generator<string> {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) return;
  for (let t = start; t <= end; t += DAY_MS) {
    yield new Date(t).toISOString().slice(0, 10);
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Merge daily intake macros with daily training UTSS into one zero-filled series
 * for the block view (FR-3.3). Nutrition is bucketed by each row's user-local
 * `logDate`; UTSS is keyed by `dailyLoads[].date`; the two join on the shared
 * `YYYY-MM-DD` grain. Every day in `[from, to]` gets a point (zero where there's
 * no intake / no training), ascending by date. Pure and DB-free.
 */
export function buildBlockView(
  rows: LogEntryWithFood[],
  dailyLoads: ReadonlyArray<DailyUtss>,
  range: DateRange,
): BlockViewPoint[] {
  const rowsByDate = new Map<string, LogEntryWithFood[]>();
  for (const row of rows) {
    const bucket = rowsByDate.get(row.logDate);
    if (bucket) bucket.push(row);
    else rowsByDate.set(row.logDate, [row]);
  }

  const utssByDate = new Map<string, number>();
  for (const d of dailyLoads) utssByDate.set(d.date, d.utss);

  const points: BlockViewPoint[] = [];
  for (const date of eachDate(range.from, range.to)) {
    const dayRows = rowsByDate.get(date) ?? [];
    points.push({
      date,
      ...roundMacros(sumNutrition(dayRows)),
      utss: round1(utssByDate.get(date) ?? 0),
    });
  }
  return points;
}
