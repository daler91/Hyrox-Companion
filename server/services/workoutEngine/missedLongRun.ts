/**
 * The long run after a missed long run.
 *
 * The long run is the one run the plan grows every loading week (running.ts:
 * by up to 8% toward the goal's cap), so it is the one a miss leaves ahead of
 * the athlete: miss 9 km and next week still reads 10. Threshold and interval
 * sessions keep one shape through a phase, so the session after a missed one
 * is the same session and has nothing to hold.
 *
 * The same answer as for a lift (./missedSessions.ts): the next long run that
 * climbs past the missed distance repeats it, the ones after follow at the
 * plan's own rate, and the hold is recorded so it can be taken back. Only rows
 * that state a distance are read; a long run prescribed by time is left to
 * the coach.
 */
import { dayDiff } from "@shared/dateUtils";
import type { PlanMissHold } from "@shared/schema";

import type { AdaptablePlanDay, AdaptationInput, MissedPlanSession } from "./adaptationTypes";
import {
  displayRunDistance,
  LONG_RUN,
  longRunMeters,
  markHeld,
  nearDayName,
  plannedRunMeters,
  recordRunChange,
  roundRunMeters,
  runUnitLabel,
  type WorkingDay,
} from "./adaptationWorking";
import { collectRunEfforts } from "./running";

/** The unit a long-run hold records its distances in, whatever unit the rows store. */
export const LONG_RUN_HOLD_UNIT = "m";
/** How fast the long run builds again after a hold: the plan's own weekly growth (running.ts). */
const WEEKLY_GROWTH = 0.08;
/**
 * A long run this far beyond the missed one is not its next step (a plan
 * edited by hand, a race-distance rehearsal), so a miss does not shorten it.
 */
const MAX_STEP_ABOVE_MISS = 0.25;
/** A long run from this share of the missed distance up already repeats it; a shorter one is an easy week. */
const REPEATS_STEP_FROM = 0.95;
/** A run this share of the missed distance, logged since, is the long run done after all. */
const MADE_UP_FROM = 0.9;
/** Below this a "long run" row is a warm-up or a typo, not a step of the progression. */
const MIN_LONG_RUN_METERS = 1000;
/** Two distances closer than this are the same distance. */
export const SAME_DISTANCE_METERS = 50;
const MAX_HOLD_SETS = 100;

/**
 * A missed step no session in range answers yet: none ahead climbs past it and
 * none repeats it. Not the same as nothing to hold. The session that would
 * climb past it may be further out than the adaptation reads (a session
 * skipped three weeks ahead, whose next exposure is the week after), so the
 * miss is looked at again on a later pass (missedSessions.ts,
 * holdMissedSessions).
 */
export const NOT_YET_IN_RANGE = "not-yet-in-range";

/** What a pass makes of one missed step: the hold it wrote, null when nothing needs holding, or not yet. */
export type StepHold = PlanMissHold | typeof NOT_YET_IN_RANGE | null;

/**
 * Where the sessions after a missed step stand: the index a hold starts at,
 * "repeats" when the plan repeats the step itself, or NOT_YET_IN_RANGE.
 */
export type ClimbPast = number | "repeats" | typeof NOT_YET_IN_RANGE;

/** A missed session's long run in metres, or 0 when it had none with a distance. */
export function missedLongRunMeters(miss: MissedPlanSession, athleteUnit: string): number {
  let total = 0;
  for (const set of miss.sets) {
    if (set.exerciseName !== LONG_RUN) continue;
    total += plannedRunMeters(set, athleteUnit) ?? 0;
  }
  return total;
}

/** Whether the athlete has logged a run of at least `meters` on or after `date`. */
export function ranSince(input: AdaptationInput, date: string, meters: number): boolean {
  return collectRunEfforts(input.logs, input.sets, input.distanceUnit).some(
    (effort) => effort.date >= date && effort.meters >= meters * MADE_UP_FROM,
  );
}

/**
 * Where a hold starts: the first later long run that climbs past the missed
 * one. A shorter one before it (a deload, a taper) is passed over; one of
 * about the missed distance means the plan repeats the step itself. With
 * neither in range, the answer is not in yet.
 */
function firstClimbPast(later: readonly WorkingDay[], missedMeters: number): ClimbPast {
  for (const [index, day] of later.entries()) {
    const planned = longRunMeters(day);
    if (planned > missedMeters * (1 + MAX_STEP_ABOVE_MISS)) continue;
    if (planned > missedMeters + SAME_DISTANCE_METERS) return index;
    if (planned >= missedMeters * REPEATS_STEP_FROM) return "repeats";
  }
  return NOT_YET_IN_RANGE;
}

/** Bring a day's long run down to `capMeters`, each row by the same share. */
function shortenLongRun(day: WorkingDay, capMeters: number, athleteUnit: string): void {
  const before = longRunMeters(day);
  const share = capMeters / before;
  for (const [setId, meters] of day.runMeters) {
    day.runMeters.set(setId, meters * share);
    day.touchedRuns.add(setId);
  }
  recordRunChange(day, "hold", before, athleteUnit);
}

function missReason(miss: MissedPlanSession, missedMeters: number, input: AdaptationInput): string {
  const distance = `${displayRunDistance(missedMeters, input.distanceUnit)} ${runUnitLabel(input.distanceUnit)}`;
  const what = `${nearDayName(miss.date, input.today)}'s Long Run (${distance})`;
  const then = "so it repeats that distance rather than jumping ahead";
  // A declared absence is never called a miss (shared/absence.ts).
  if (miss.kind === "excused") return `${what} didn't happen, ${then}`;
  if (miss.kind === "skipped") {
    return `${miss.date >= input.today ? "you're skipping" : "you skipped"} ${what}, ${then}`;
  }
  return `you missed ${what}, ${then}`;
}

/**
 * Hold the long run at the distance a session never did. Returns what it
 * shortened; null when there is nothing to hold (no long run in the missed
 * session, one run since anyway, or the plan repeats the distance itself);
 * NOT_YET_IN_RANGE when no long run in range answers it yet.
 */
export function holdMissedLongRun(
  working: readonly WorkingDay[],
  miss: MissedPlanSession,
  input: AdaptationInput,
  horizonEnd: string,
): StepHold {
  const missedMeters = missedLongRunMeters(miss, input.distanceUnit);
  if (missedMeters < MIN_LONG_RUN_METERS) return null;
  if (ranSince(input, miss.date, missedMeters)) return null;
  const later = working.filter(
    (day) => day.day.date > miss.date && day.day.date <= horizonEnd && day.runMeters.size > 0,
  );
  const start = firstClimbPast(later, missedMeters);
  if (start === NOT_YET_IN_RANGE) return NOT_YET_IN_RANGE;
  const first = start === "repeats" ? undefined : later.at(start);
  if (start === "repeats" || !first) return null;

  const sets: PlanMissHold["sets"] = [];
  let held = 0;
  for (const day of later.slice(start)) {
    const weeks = Math.max(0, dayDiff(first.day.date, day.day.date)) / 7;
    const target = missedMeters * (1 + WEEKLY_GROWTH) ** weeks;
    const cap = roundRunMeters(target, input.distanceUnit);
    const planned = longRunMeters(day);
    if (planned > target * (1 + MAX_STEP_ABOVE_MISS) || planned <= cap + SAME_DISTANCE_METERS) continue;
    const before = new Map(day.runMeters);
    const changesBefore = day.changes.length;
    shortenLongRun(day, cap, input.distanceUnit);
    for (const [setId, from] of before) {
      sets.push({ setId, from, to: day.runMeters.get(setId) ?? from });
    }
    day.reasons.push(
      held === 0 ? missReason(miss, missedMeters, input) : "Long Run keeps building from the repeated distance",
    );
    markHeld(day, miss, day.changes.slice(changesBefore));
    held += 1;
  }
  if (sets.length === 0) return null;
  return {
    planDayId: miss.planDayId,
    missedOn: miss.date,
    exercise: LONG_RUN,
    unit: LONG_RUN_HOLD_UNIT,
    sets: sets.slice(0, MAX_HOLD_SETS),
  };
}

/**
 * Take a long-run hold back: the rows it shortened return to their distance,
 * where they still read what the hold wrote.
 */
export function releaseLongRunHold(
  working: readonly WorkingDay[],
  hold: PlanMissHold,
  input: AdaptationInput,
  reason: string,
): void {
  const before = new Map<WorkingDay, number>();
  for (const record of hold.sets) {
    const day = working.find((candidate) => candidate.runMeters.has(record.setId));
    const current = day?.runMeters.get(record.setId);
    if (!day || current == null || Math.abs(current - record.to) > SAME_DISTANCE_METERS) continue;
    if (!before.has(day)) before.set(day, longRunMeters(day));
    day.runMeters.set(record.setId, record.from);
    day.touchedRuns.add(record.setId);
  }
  for (const [day, meters] of before) {
    recordRunChange(day, "raise", meters, input.distanceUnit);
    day.reasons.push(reason);
  }
}

/** The long run a hold left on `day`, before and after, in metres; null when none of its rows are the hold's. */
export function heldLongRun(
  hold: PlanMissHold,
  day: AdaptablePlanDay,
): { readonly from: number; readonly to: number } | null {
  const records = new Map(hold.sets.map((record) => [record.setId, record]));
  let from = 0;
  let to = 0;
  let found = false;
  for (const set of day.sets) {
    const record = records.get(set.id);
    if (!record) continue;
    found = true;
    from += record.from;
    to += record.to;
  }
  return found ? { from, to } : null;
}
