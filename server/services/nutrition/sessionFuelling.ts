import type { FoodLogEntryWithNutrition, NutritionMacroTotals } from "@shared/schema";

import { type LogEntryWithFood, summariseEntries } from "./rollup";

/**
 * Fuelling-around-a-session windows (FR-3.1 pre / FR-3.2 post recovery).
 *
 * `pre` is the carb-forward window before the start; `post` is the longer
 * protein/recovery window after it. Both are anchored on the workout's true
 * start instant when we have it (captured from Strava/Garmin at import);
 * otherwise the route hands us the session day's entries and we fall back to the
 * explicit pre_workout / post_workout meal tags.
 */
export const PRE_WINDOW_MS = 4 * 60 * 60 * 1000; // 4h before start
export const POST_WINDOW_MS = 6 * 60 * 60 * 1000; // 6h after start

export interface SessionFuelling {
  pre: FoodLogEntryWithNutrition[];
  post: FoodLogEntryWithNutrition[];
  preTotals: NutritionMacroTotals;
  postTotals: NutritionMacroTotals;
  // true → split by the real start-time windows; false → by pre/post_workout tags.
  usedStartTime: boolean;
}

/** Coerce a Date|string|null into a valid Date, or null. */
function toInstant(value: Date | string | null): Date | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function assemble(
  preRows: LogEntryWithFood[],
  postRows: LogEntryWithFood[],
  usedStartTime: boolean,
): SessionFuelling {
  const pre = summariseEntries(preRows);
  const post = summariseEntries(postRows);
  return {
    pre: pre.entries,
    post: post.entries,
    preTotals: pre.totals,
    postTotals: post.totals,
    usedStartTime,
  };
}

/**
 * Split a session's surrounding entries into pre/post groups with macro totals.
 *
 * - **Start instant known** (`usedStartTime: true`): `pre` = entries logged in
 *   `[start − PRE_WINDOW, start)`, `post` = entries in `[start, start + POST_WINDOW]`.
 *   The route supplies entries already fetched for that window.
 * - **Start instant null** (`usedStartTime: false`, legacy/manual rows): fall back
 *   to the explicit `pre_workout` / `post_workout` meal tags on the session's day;
 *   the route supplies that day's entries.
 *
 * Pure and DB-free so the windowing rule is unit-testable in isolation.
 */
export function computeSessionFuelling(
  workout: { date: string; startedAt: Date | string | null },
  entries: LogEntryWithFood[],
): SessionFuelling {
  const start = toInstant(workout.startedAt);
  if (start) {
    const startMs = start.getTime();
    const preRows: LogEntryWithFood[] = [];
    const postRows: LogEntryWithFood[] = [];
    for (const entry of entries) {
      const t = toInstant(entry.loggedAt)?.getTime();
      if (t === undefined) continue;
      if (t >= startMs - PRE_WINDOW_MS && t < startMs) preRows.push(entry);
      else if (t >= startMs && t <= startMs + POST_WINDOW_MS) postRows.push(entry);
    }
    return assemble(preRows, postRows, true);
  }

  const preRows = entries.filter((e) => e.mealType === "pre_workout");
  const postRows = entries.filter((e) => e.mealType === "post_workout");
  return assemble(preRows, postRows, false);
}
