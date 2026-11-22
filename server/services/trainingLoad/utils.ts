// Training load internal helpers (audit A7: split out of trainingLoadService.ts).
//
// Small helpers that more than one trainingLoad module needs: rounding, the
// inclusive ISO date range, the per-day record factory and the workout-text
// reader. Not part of the service's public surface; nothing here is re-exported.

import { addDaysToISODate as addDays } from "@shared/dateUtils";
import type { WorkoutLog } from "@shared/schema";

import type { DailyTrainingLoad, LoadVector } from "./types";

export function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function emptyVectorLoads(): Record<LoadVector, number> {
  return {
    posterior_chain: 0,
    anterior_chain: 0,
    unilateral_stability: 0,
    elastic_tendon: 0,
  };
}

export function getOrCreateDay(
  map: Map<string, DailyTrainingLoad>,
  date: string,
): DailyTrainingLoad {
  let day = map.get(date);
  if (!day) {
    day = {
      date,
      strengthStressScore: 0,
      cardioStressScore: 0,
      utss: 0,
      acwr: null,
      zone: "insufficient_data",
      vectorLoads: emptyVectorLoads(),
      acuteEwma: null,
      chronicEwma: null,
      tsb: null,
      monotony: null,
      strain: null,
      hrTss: null,
      hrZone: null,
      tss: null,
    };
    map.set(date, day);
  }
  return day;
}

/**
 * Every date from `start` to `end` (YYYY-MM-DD), inclusive. Empty for an
 * unparseable bound, like `eachDate` in nutrition/blockView.ts: the loop
 * compares strings, so a malformed `end` would never stop it. Current callers
 * pass dates the server computed (S-dateRange, REFACTORING_REVIEW 2026-09-23).
 */
export function dateRange(start: string, end: string): string[] {
  const result: string[] = [];
  if (Number.isNaN(Date.parse(`${start}T00:00:00Z`)) || Number.isNaN(Date.parse(`${end}T00:00:00Z`))) {
    return result;
  }
  for (let date = start; date <= end; date = addDays(date, 1)) {
    result.push(date);
  }
  return result;
}

export function inferWorkoutText(
  log: Pick<WorkoutLog, "focus" | "mainWorkout" | "accessory" | "notes">,
): string {
  return [log.focus, log.mainWorkout, log.accessory ?? "", log.notes ?? ""].join(" ").toLowerCase();
}
