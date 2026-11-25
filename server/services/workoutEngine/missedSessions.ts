/**
 * Following the sessions that never happened.
 *
 * A generated plan climbs week on week on the assumption that every session
 * is done, so a missed one leaves the next session a step ahead of the
 * athlete: miss 5x5 @ 100 kg and next week still reads 102.5 kg. This is the
 * part of the adaptation (./adaptation.ts) that reads the plan's own days as
 * well as the logs: each lift of a session that was missed or skipped picks
 * up from the step that was not done, and the hold is taken back if the
 * session returns to the plan (folded into another day, or logged late).
 *
 * Pure, like the rest of the adaptation: the caller says which sessions are
 * not happening and which have returned (planAdaptationService).
 */
import { addDaysToISODate, dayDiff } from "@shared/dateUtils";
import type { PlanEngineState, PlanMissHold } from "@shared/schema";
import { storedWeightToDisplay, type WeightUnit } from "@shared/unitConversion";

import { shortDate } from "../missedRecovery/planner";
import { planDeloadWeeks } from "../planBlueprint";
import type { AdaptablePlanSet, AdaptationInput, MissedPlanSession } from "./adaptationTypes";
import {
  applyDecision,
  equivalentLoad,
  exerciseLabel,
  isAdaptableSet,
  loggedLift,
  MAX_STEP_ABOVE_MISS,
  recordChange,
  repsOf,
  setsOf,
  topWeight,
  weekdayName,
  type WorkingDay,
} from "./adaptationWorking";
import { implementFor, liftKey } from "./loadMath";

/** Sessions missed longer ago than this are the return-from-break rule's to handle. */
export const MISSED_SESSION_WINDOW_DAYS = 14;
/**
 * A session from this share of the missed load up to the load itself already
 * repeats the missed step; one below it is the week's lighter exposure.
 */
const REPEATS_STEP_FROM = 0.95;
/** A hold older than this has been trained past: it can no longer be taken back. */
const MISS_HOLD_MAX_AGE_DAYS = 28;
const MAX_ADAPTED_MISSES = 200;
const MAX_MISS_HOLDS = 50;
const MAX_HOLD_SETS = 100;
/** Two loads in the same unit closer than this are the same load. */
const SAME_LOAD_TOLERANCE = 0.01;

function missKey(miss: { readonly planDayId: string; readonly date: string }): string {
  return `${miss.planDayId}|${miss.date}`;
}

/** "Tuesday" within a week of today, "Tue 22 Sep" beyond it. */
function nearDayName(date: string, today: string): string {
  return Math.abs(dayDiff(today, date)) < 7 ? weekdayName(date) : shortDate(date);
}

/** One lift of a session that never happened: its heaviest prescribed set. */
interface MissedLift {
  readonly exercise: string;
  /** In the athlete's unit. */
  readonly load: number;
  readonly reps: number;
  /** "4x6 @ 85 kg". */
  readonly text: string;
}

function isHoldablePlanSet(set: AdaptablePlanSet): boolean {
  if (!isAdaptableSet(set) || implementFor(set.exerciseName) === "bodyweight") return false;
  // An unlabelled custom set is no lift in particular (D14).
  return liftKey(set) !== "custom";
}

function missedLifts(miss: MissedPlanSession, unit: WeightUnit): MissedLift[] {
  const byExercise = new Map<string, AdaptablePlanSet[]>();
  for (const set of miss.sets) {
    if (!isHoldablePlanSet(set)) continue;
    const exercise = liftKey(set);
    byExercise.set(exercise, [...(byExercise.get(exercise) ?? []), set]);
  }
  return [...byExercise].map(([exercise, sets]) => {
    const loads = sets.map((set) =>
      storedWeightToDisplay(set.weight ?? 0, { weightUnit: set.weightUnit }, { weightUnit: unit }),
    );
    const load = Math.max(...loads);
    const reps = sets.at(loads.indexOf(load))?.reps ?? 5;
    const uniform = loads.every((each) => each === load) && sets.every((set) => set.reps === reps);
    const text = uniform ? `${sets.length}x${reps} @ ${load} ${unit}` : `${load} ${unit} x ${reps}`;
    return { exercise, load, reps, text };
  });
}

/** Whether the athlete has logged the lift on or after `date`, in any session. */
function trainedSince(input: AdaptationInput, exercise: string, date: string): boolean {
  return input.sets.some(
    (set) => set.date >= date && isAdaptableSet(set) && loggedLift(set) === exercise,
  );
}

function missReason(miss: MissedPlanSession, lift: MissedLift, today: string): string {
  const what = `${nearDayName(miss.date, today)}'s ${exerciseLabel(lift.exercise)} (${lift.text})`;
  const then = "so it picks up from that load rather than jumping ahead";
  // A declared absence is never called a miss (shared/absence.ts).
  if (miss.kind === "excused") return `${what} didn't happen, ${then}`;
  if (miss.kind === "skipped") {
    return `${miss.date >= today ? "you're skipping" : "you skipped"} ${what}, ${then}`;
  }
  return `you missed ${what}, ${then}`;
}

/**
 * Where a hold starts: the first later session of the lift that climbs past
 * the missed step, or -1 when none does. The lighter exposures before it are
 * passed over, and so is one far above the step (MAX_STEP_ABOVE_MISS). A
 * session at about the missed load comes first when the plan repeats the step
 * itself (the lift's second day that week, a lighter week), and then nothing
 * needs holding.
 */
function firstClimbPast(later: readonly WorkingDay[], lift: MissedLift): number {
  for (const [index, day] of later.entries()) {
    const step = equivalentLoad(lift.load, lift.reps, repsOf(day, lift.exercise));
    const top = topWeight(day, lift.exercise);
    if (top > step * (1 + MAX_STEP_ABOVE_MISS)) continue;
    if (top > step + SAME_LOAD_TOLERANCE) return index;
    if (top >= step * REPEATS_STEP_FROM) return -1;
  }
  return -1;
}

/**
 * Hold one lift at the step a session never did: its next session repeats the
 * missed load instead of climbing past it, and the ones after resume from
 * there (applyCap). Returns what it lowered, or null when nothing was.
 */
function holdMissedLift(
  working: readonly WorkingDay[],
  miss: MissedPlanSession,
  lift: MissedLift,
  input: AdaptationInput,
  horizonEnd: string,
): PlanMissHold | null {
  const later = working.filter(
    (day) =>
      day.day.date > miss.date &&
      day.day.date <= horizonEnd &&
      setsOf(day, lift.exercise).length > 0,
  );
  const start = firstClimbPast(later, lift);
  if (start < 0) return null;
  const targets = later.slice(start);
  const before = new Map<string, number>();
  for (const day of targets) {
    for (const set of setsOf(day, lift.exercise)) before.set(set.id, day.weights.get(set.id) ?? 0);
  }
  applyDecision(
    { log: { id: missKey(miss), date: miss.date }, exercise: lift.exercise, sets: [] },
    {
      kind: "cap",
      load: lift.load,
      reps: lift.reps,
      deload: false,
      reason: missReason(miss, lift, input.today),
      followUp: `${exerciseLabel(lift.exercise)} keeps building from the repeated step`,
      missedStep: true,
    },
    targets,
    { unit: input.weightUnit, fatigued: input.fatigued },
  );
  const sets: PlanMissHold["sets"] = [];
  for (const day of targets) {
    for (const set of setsOf(day, lift.exercise)) {
      const from = before.get(set.id);
      const to = day.weights.get(set.id);
      if (from != null && to != null && to !== from) sets.push({ setId: set.id, from, to });
    }
  }
  if (sets.length === 0) return null;
  return {
    planDayId: miss.planDayId,
    missedOn: miss.date,
    exercise: lift.exercise,
    unit: input.weightUnit,
    sets: sets.slice(0, MAX_HOLD_SETS),
  };
}

/**
 * Take a hold back: the step it stood for is being done after all, so the
 * loads it lowered return — but only where a set still reads what the hold
 * wrote. A load the athlete edited, or a later log moved, is theirs. `reason`
 * is the coach note's sentence on each day it restores.
 */
function releaseHold(
  working: readonly WorkingDay[],
  hold: PlanMissHold,
  input: AdaptationInput,
  reason: string,
): void {
  // Written in another unit: the loads cannot be compared, so they stand.
  if (hold.unit !== input.weightUnit) return;
  const topBefore = new Map<WorkingDay, number>();
  for (const record of hold.sets) {
    const day = working.find((candidate) => candidate.weights.has(record.setId));
    const current = day?.weights.get(record.setId);
    if (!day || current == null || Math.abs(current - record.to) > SAME_LOAD_TOLERANCE) continue;
    if (!topBefore.has(day)) topBefore.set(day, topWeight(day, hold.exercise));
    day.weights.set(record.setId, record.from);
    // The restored load is the plan's own, so a raise this pass builds on it.
    day.startWeights.set(record.setId, record.from);
    day.touchedSets.add(record.setId);
  }
  for (const [day, before] of topBefore) {
    recordChange(day, hold.exercise, "raise", before, input.weightUnit);
    day.reasons.push(reason);
  }
}

/** The engine's record of missed sessions, as one pass carries it. */
export interface MissRecord {
  /** Misses already reflected in the plan (missKey), oldest first. */
  readonly adapted: Set<string>;
  /** Holds that can still be taken back. */
  readonly holds: PlanMissHold[];
}

/**
 * Open the pass's record of missed sessions, or null when the caller gave
 * none to look at. Each hold kept from an earlier pass is settled here,
 * before any log is read, so a raise this pass builds on a restored load:
 *
 *   - its session is back in the plan (moved to a day ahead, logged late)
 *     → taken back, and the session counts afresh if it is missed again;
 *   - its day was deleted → dropped, nothing to take back;
 *   - the lift was trained anyway before any held session came up (the
 *     session done as a workout of its own) → taken back: the step was made up;
 *   - the lift was trained in a held session, or the miss is long ago → dropped
 *     and the loads stand: the plan has moved on from the held load.
 */
export function openMissRecord(
  working: readonly WorkingDay[],
  input: AdaptationInput,
  state: PlanEngineState,
): MissRecord | null {
  if (!input.missed) return null;
  const stillMissed = new Set(input.missed.map(missKey));
  const returned = input.returnedPlanDayIds ?? new Set<string>();
  const adapted = new Set(state.adaptedMisses ?? []);
  const holds: PlanMissHold[] = [];
  // Every session still ahead, a day another stage rewrote this pass included:
  // a held set missing from here belongs to a session that has been and gone.
  const stillAhead = new Set(
    input.upcoming
      .filter((day) => day.date >= input.today)
      .flatMap((day) => day.sets.map((set) => set.id)),
  );
  for (const hold of state.missHolds ?? []) {
    const key = missKey({ planDayId: hold.planDayId, date: hold.missedOn });
    const when = nearDayName(hold.missedOn, input.today);
    const label = exerciseLabel(hold.exercise);
    if (!stillMissed.has(key)) {
      if (returned.has(hold.planDayId)) {
        const reason = `${when}'s session is no longer missed, so ${label} returns to its planned load`;
        releaseHold(working, hold, input, reason);
        adapted.delete(key);
      }
      continue;
    }
    if (dayDiff(hold.missedOn, input.today) > MISS_HOLD_MAX_AGE_DAYS) continue;
    if (!trainedSince(input, hold.exercise, hold.missedOn)) {
      holds.push(hold);
      continue;
    }
    if (hold.sets.every((record) => stillAhead.has(record.setId))) {
      const reason = `you have trained ${label} since ${when}'s session, so it returns to its planned load`;
      releaseHold(working, hold, input, reason);
    }
  }
  return { adapted, holds };
}

/**
 * Follow the sessions that never happened. A generated plan climbs week on
 * week on the assumption that every session is done; a missed one leaves the
 * next session a step ahead of the athlete. So each lift of a missed session
 * is held at the missed load — once per miss, like a log — and the hold is
 * remembered so it can be taken back if the session returns.
 *
 * Nothing is held for a lift the athlete has trained since anyway, for a
 * deload week (no step of the progression was lost), or on a session well
 * above the missed load (the week's heavier exposure, a new block).
 */
export function holdMissedSessions(
  working: readonly WorkingDay[],
  input: AdaptationInput,
  record: MissRecord,
  horizonEnd: string,
): Pick<PlanEngineState, "adaptedMisses" | "missHolds"> {
  const { adapted, holds } = record;
  const missed = [...(input.missed ?? [])].sort(
    (a, b) => a.date.localeCompare(b.date) || a.planDayId.localeCompare(b.planDayId),
  );
  const windowStart = addDaysToISODate(input.today, -MISSED_SESSION_WINDOW_DAYS);
  const deloadWeeks = new Set(planDeloadWeeks(input.plan.totalWeeks));
  for (const miss of missed) {
    const key = missKey(miss);
    if (adapted.has(key) || miss.date < windowStart) continue;
    adapted.add(key);
    if (deloadWeeks.has(miss.weekNumber)) continue;
    for (const lift of missedLifts(miss, input.weightUnit)) {
      if (trainedSince(input, lift.exercise, miss.date)) continue;
      const hold = holdMissedLift(working, miss, lift, input, horizonEnd);
      if (hold) holds.push(hold);
    }
  }
  return {
    adaptedMisses: [...adapted].slice(-MAX_ADAPTED_MISSES),
    missHolds: holds.slice(-MAX_MISS_HOLDS),
  };
}
