/**
 * The plan adaptation's working copy of the upcoming sessions, and the moves
 * it makes on it: raise a lift's loads, or cap them (a hold, a deload, a
 * return from a break, a step that was missed). Every rule in ./adaptation.ts
 * and ./missedSessions.ts decides; this applies the decision and keeps the
 * record the coach note is written from.
 */
import { dayDiff, PLAN_WEEKDAYS, weekdayIndex } from "@shared/dateUtils";
import type { TrainingPhase } from "@shared/nutritionTargets";
import { computePlanPhase } from "@shared/planPhase";
import { epley, epleyLoad } from "@shared/progression";
import type { CoachMissedSessionHold } from "@shared/schema";
import { knownExerciseLabel } from "@shared/schema/exercises";
import { storedWeightToDisplay, type WeightUnit } from "@shared/unitConversion";

import type {
  AdaptablePlanDay,
  AdaptablePlanSet,
  AdaptationInput,
  AdaptationLog,
  AdaptationSet,
  ProgressionChange,
  ProgressionChangeKind,
} from "./adaptationTypes";
import { ASSUMED_RIR, customLiftLabel, liftKey, roundLoad } from "./loadMath";
import { rewriteLiftLoad } from "./planRepair";

/** Load changes reach this far ahead; later sessions follow as later logs arrive. */
export const LOAD_HORIZON_DAYS = 21;
/** One session may lift the plan by at most this much. */
export const MAX_RAISE = 0.05;
/** After a hold or deload, progression resumes at this rate per week. */
const RESUME_RATE_PER_WEEK = 0.025;
/** Epley holds for 1-12 reps; beyond that a set is conditioning, not a load test. */
const MAX_ADAPT_REPS = 12;
/**
 * A session this far above the missed load is not the missed step's next one
 * (the week's heavier exposure of the lift, or a new block), so a miss does
 * not pull it down.
 */
export const MAX_STEP_ABOVE_MISS = 0.1;
/** What a progression change's exercise name may hold (progressionChangeSchema). */
const MAX_CHANGE_NAME = 100;

// ---------------------------------------------------------------------------
// Working state
// ---------------------------------------------------------------------------

export interface WorkingDay {
  readonly day: AdaptablePlanDay;
  readonly phase: TrainingPhase | undefined;
  /** Current weight of each set, in the athlete's unit, as adapted so far. */
  readonly weights: Map<string, number>;
  /**
   * Each set's weight before this pass, which every raise in it is measured
   * from. A hold taken back moves it: the restored load is the plan's own.
   */
  readonly startWeights: Map<string, number>;
  readonly touchedSets: Set<string>;
  mainWorkout: string;
  accessory: string | null;
  notes: string | null;
  readonly setNotes: Map<string, string>;
  readonly changes: ProgressionChange[];
  readonly reasons: string[];
  /**
   * The session that never happened which this pass held the day for, with
   * the loads it held (./missedSessions.ts): what the day's card shows.
   */
  missedSessionHold: CoachMissedSessionHold | null;
}

export function toWorkingDay(day: AdaptablePlanDay, input: AdaptationInput): WorkingDay {
  const weights = new Map<string, number>();
  for (const set of day.sets) {
    if (set.weight == null || set.weight <= 0) continue;
    weights.set(
      set.id,
      storedWeightToDisplay(
        set.weight,
        { weightUnit: set.weightUnit },
        { weightUnit: input.weightUnit },
      ),
    );
  }
  return {
    day,
    phase: computePlanPhase(input.plan.totalWeeks, day.weekNumber)?.phaseLabel,
    weights,
    startWeights: new Map(weights),
    touchedSets: new Set(),
    mainWorkout: day.mainWorkout,
    accessory: day.accessory ?? null,
    notes: day.notes ?? null,
    setNotes: new Map(),
    changes: [],
    reasons: [],
    missedSessionHold: null,
  };
}

export function exerciseLabel(exercise: string): string {
  return customLiftLabel(exercise) ?? knownExerciseLabel(exercise) ?? exercise.replaceAll("_", " ");
}

/**
 * The lift a logged set trained, or null for a custom set with no label:
 * nothing tells it apart from any other custom lift, so it adapts none of them.
 * D14 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function loggedLift(set: AdaptationSet): string | null {
  const key = liftKey(set);
  return key === "custom" ? null : key;
}

export function weekdayName(date: string): string {
  return PLAN_WEEKDAYS[weekdayIndex(date)] ?? date;
}

// ---------------------------------------------------------------------------
// What a rule decides
// ---------------------------------------------------------------------------

export interface LoggedSession {
  readonly log: AdaptationLog;
  readonly exercise: string;
  readonly sets: readonly AdaptationSet[];
}

export type Decision =
  | { readonly kind: "raise"; readonly factor: number; readonly reason: string }
  | {
      readonly kind: "cap";
      readonly load: number;
      readonly reps: number;
      readonly deload: boolean;
      readonly reason: string;
      /** What the later sessions it reaches say; defaults to following the logged session. */
      readonly followUp?: string;
      /**
       * The load is a step of the plan nobody failed at; it was simply not
       * done (a missed session). Later sessions follow it to the nearest plate
       * rather than rounded down, so the plan ends up one step behind instead
       * of drifting further, and a session more than MAX_STEP_ABOVE_MISS
       * above it is another exposure of the lift, which a miss leaves alone.
       */
      readonly missedStep?: boolean;
    }
  | { readonly kind: "catch_up"; readonly e1rm: number; readonly performed: string }
  | { readonly kind: "none" };

export function inUnit(value: number, set: AdaptationSet, unit: WeightUnit): number {
  return storedWeightToDisplay(value, { weightUnit: set.weightUnit }, { weightUnit: unit });
}

/** Weighted strength sets Epley can read: 1-12 reps with a load. */
export function isAdaptableSet(set: Pick<AdaptationSet, "category" | "reps" | "weight">): boolean {
  if (set.category != null && set.category !== "strength") return false;
  const reps = set.reps ?? 0;
  return (set.weight ?? 0) > 0 && reps >= 1 && reps <= MAX_ADAPT_REPS;
}


// ---------------------------------------------------------------------------
// Applying a decision to the upcoming sessions of the lift
// ---------------------------------------------------------------------------

export function setsOf(day: WorkingDay, exercise: string): AdaptablePlanSet[] {
  return day.day.sets.filter((set) => liftKey(set) === exercise && day.weights.has(set.id));
}

export function topWeight(day: WorkingDay, exercise: string): number {
  return Math.max(0, ...setsOf(day, exercise).map((set) => day.weights.get(set.id) ?? 0));
}

export function repsOf(day: WorkingDay, exercise: string): number {
  const sets = setsOf(day, exercise);
  const top = topWeight(day, exercise);
  return sets.find((set) => day.weights.get(set.id) === top)?.reps ?? sets[0]?.reps ?? 5;
}

/** The load for `reps` that matches `load` for `fromReps` on the same effort. */
export function equivalentLoad(load: number, fromReps: number, reps: number): number {
  return epleyLoad(epley(load, fromReps + ASSUMED_RIR), reps + ASSUMED_RIR);
}

function canRise(day: WorkingDay): boolean {
  return day.phase !== "taper" && day.phase !== "race_week";
}

export function recordChange(
  day: WorkingDay,
  exercise: string,
  kind: ProgressionChangeKind,
  from: number,
  unit: WeightUnit,
): void {
  const to = topWeight(day, exercise);
  if (to === from) return;
  // A custom lift's key is not a name the coach note can show: its label is.
  const name = customLiftLabel(exercise)?.slice(0, MAX_CHANGE_NAME) ?? exercise;
  day.changes.push({ exercise: name, kind, from, to, unit });
  day.mainWorkout = rewriteLiftLoad(day.mainWorkout, exercise, to, unit);
  if (day.accessory) day.accessory = rewriteLiftLoad(day.accessory, exercise, to, unit);
}

function applyRaise(
  days: readonly WorkingDay[],
  exercise: string,
  factor: number,
  unit: WeightUnit,
): WorkingDay[] {
  const changed: WorkingDay[] = [];
  for (const day of days) {
    if (!canRise(day)) continue;
    const before = topWeight(day, exercise);
    for (const set of setsOf(day, exercise)) {
      const weight = day.weights.get(set.id) ?? 0;
      // Each log in a pass measured its surplus against its own prescription,
      // so a second raise is the same evidence again: it starts from the
      // lower of the pass's starting load and the current one, never on top of
      // an earlier raise. C14 (CODEBASE_ANALYSIS_2026-10-03)
      const base = Math.min(weight, day.startWeights.get(set.id) ?? weight);
      const raised = roundLoad(base * factor, exercise, unit);
      if (raised <= weight) continue;
      day.weights.set(set.id, raised);
      day.touchedSets.add(set.id);
    }
    recordChange(day, exercise, "raise", before, unit);
    if (topWeight(day, exercise) !== before) changed.push(day);
  }
  return changed;
}

/**
 * Hold or deload: the first upcoming session is capped at the decided load
 * (converted to its own reps), and each later one at that cap grown 2.5% a
 * week — progression resumes from the new level instead of jumping back to
 * the old plan. Caps only lower weights; a set already under its cap stays.
 */
function applyCap(
  days: readonly WorkingDay[],
  exercise: string,
  decision: Extract<Decision, { kind: "cap" }>,
  unit: WeightUnit,
): WorkingDay[] {
  const first = days.at(0);
  if (!first) return [];
  const changed: WorkingDay[] = [];
  for (const day of days) {
    const weeks = Math.max(0, dayDiff(first.day.date, day.day.date)) / 7;
    const target =
      equivalentLoad(decision.load, decision.reps, repsOf(day, exercise)) *
      (1 + RESUME_RATE_PER_WEEK) ** weeks;
    const cap = roundLoad(target, exercise, unit, decision.missedStep ? "nearest" : "down");
    const before = topWeight(day, exercise);
    if (decision.missedStep && before > target * (1 + MAX_STEP_ABOVE_MISS)) continue;
    for (const set of setsOf(day, exercise)) {
      if ((day.weights.get(set.id) ?? 0) <= cap || cap <= 0) continue;
      day.weights.set(set.id, cap);
      day.touchedSets.add(set.id);
    }
    recordChange(day, exercise, decision.deload ? "deload" : "hold", before, unit);
    if (topWeight(day, exercise) !== before) changed.push(day);
  }
  return changed;
}

/** Ad-hoc work stronger than the plan's next session pulls the plan up to it. */
function catchUpFactor(
  decision: Extract<Decision, { kind: "catch_up" }>,
  next: WorkingDay,
  exercise: string,
): number | null {
  const load = topWeight(next, exercise);
  if (load <= 0) return null;
  const implied = epley(load, repsOf(next, exercise) + ASSUMED_RIR);
  const ratio = decision.e1rm / implied;
  return ratio >= 1 + MAX_RAISE ? Math.min(1 + MAX_RAISE, ratio) : null;
}

export interface ApplyContext {
  readonly unit: WeightUnit;
  readonly fatigued: boolean;
}

export function applyDecision(
  session: LoggedSession,
  decision: Decision,
  targets: readonly WorkingDay[],
  ctx: ApplyContext,
): void {
  const label = exerciseLabel(session.exercise);
  let changed: WorkingDay[] = [];
  let reason = "";
  if (decision.kind === "cap") {
    changed = applyCap(targets, session.exercise, decision, ctx.unit);
    reason = decision.reason;
  } else if ((decision.kind === "raise" || decision.kind === "catch_up") && !ctx.fatigued) {
    const factor =
      decision.kind === "raise"
        ? decision.factor
        : catchUpFactor(decision, targets[0], session.exercise);
    if (factor == null) return;
    changed = applyRaise(targets, session.exercise, factor, ctx.unit);
    reason =
      decision.kind === "raise"
        ? decision.reason
        : `your ${weekdayName(session.log.date)} ${decision.performed} is ahead of the plan — ${label} catches up`;
  }
  const followUp =
    (decision.kind === "cap" ? decision.followUp : undefined) ??
    `${label} follows ${weekdayName(session.log.date)}'s session`;
  changed.forEach((day, index) => {
    day.reasons.push(index === 0 ? reason : followUp);
  });
}
