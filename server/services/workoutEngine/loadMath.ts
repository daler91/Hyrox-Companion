/**
 * The load arithmetic every strength target rests on: how strong the athlete
 * is on a lift right now (an estimated 1RM from what they logged), the load
 * that implies for N reps at a given effort, and rounding to a weight their
 * gym actually stocks.
 *
 * One formula throughout — Epley, the one the PR tracker and the workout
 * detail's "Next" chip already use (shared/progression.ts) — so a target the
 * engine writes into a plan and a target the chip suggests while logging sit
 * on the same scale.
 */
import { epley } from "@shared/progression";
import type { ExerciseName } from "@shared/schema/exercises";
import { storedWeightToDisplay, type WeightUnit } from "@shared/unitConversion";

import { EXERCISE_EQUIPMENT } from "../ai/exerciseKnowledge";

/** The fields of a logged set the engine reads; `LoggedExerciseSetWithDate` satisfies it. */
export interface EngineSet {
  readonly exerciseName: string;
  readonly workoutLogId?: string | null;
  readonly date: string;
  readonly reps?: number | null;
  readonly weight?: number | null;
  readonly weightUnit?: string | null;
  readonly plannedReps?: number | null;
  readonly distance?: number | null;
  readonly distanceUnit?: string | null;
  readonly time?: number | null;
}

/**
 * Reps a logged working set is assumed to have left in the tank. Working sets
 * are rarely taken to failure, so reading "100 kg x 5" as a 5-rep max makes
 * the athlete look weaker than they are — and every target derived from it
 * lighter than the weight they already lift. Two is the conventional working
 * set (RPE 8); a set that fell short of its prescription is read as a true
 * max instead (see estimateStrength).
 */
export const ASSUMED_RIR = 2;
/** Epley is trusted for 1-10 rep sets, the same range as the PR metric. */
const MAX_ESTIMATE_REPS = 10;
/** One session is one data-entry error away from a bad estimate. */
const MIN_SESSIONS = 2;
/** Recent sessions the estimate is read from: current, not a 10-week average. */
const RECENT_SESSIONS = 4;
/** A best session further than this above the next is treated as an outlier. */
const OUTLIER_MARGIN = 0.1;

export type Implement = "barbell" | "dumbbell" | "kettlebell" | "machine" | "bodyweight";

/**
 * Where the equipment table can't say how an exercise is loaded: bodyweight
 * lifts (a logged weight there is added load, which Epley cannot read), and
 * lunge-family work the table leaves open because it can be done holding
 * anything — logged with dumbbells far more often than not.
 */
const IMPLEMENT_OVERRIDES: Readonly<Partial<Record<ExerciseName, Implement>>> = {
  pull_up: "bodyweight",
  chin_up: "bodyweight",
  push_up: "bodyweight",
  dip: "bodyweight",
  ring_dip: "bodyweight",
  inverted_row: "bodyweight",
  pistol_squat: "bodyweight",
  tibialis_raise: "bodyweight",
  walking_lunges: "dumbbell",
  reverse_lunge: "dumbbell",
  lunges: "dumbbell",
  split_squat: "dumbbell",
  bulgarian_split_squat: "dumbbell",
  step_ups: "dumbbell",
  calf_raise: "dumbbell",
  standing_calf_raise: "machine",
};

/** The smallest jump each implement allows, per unit. */
const INCREMENTS: Readonly<Record<Exclude<Implement, "bodyweight">, Record<WeightUnit, number>>> = {
  barbell: { kg: 2.5, lbs: 5 },
  dumbbell: { kg: 2, lbs: 5 },
  kettlebell: { kg: 4, lbs: 5 },
  machine: { kg: 5, lbs: 10 },
};

const LOADED_IMPLEMENTS: readonly Exclude<Implement, "bodyweight">[] = [
  "barbell",
  "dumbbell",
  "kettlebell",
  "machine",
];

export function implementFor(exercise: string): Implement {
  const override = IMPLEMENT_OVERRIDES[exercise as ExerciseName];
  if (override) return override;
  const equipment = EXERCISE_EQUIPMENT[exercise as ExerciseName] ?? [];
  return LOADED_IMPLEMENTS.find((implement) => equipment.includes(implement)) ?? "barbell";
}

export function loadIncrement(exercise: string, unit: WeightUnit): number {
  const implement = implementFor(exercise);
  return INCREMENTS[implement === "bodyweight" ? "barbell" : implement][unit];
}

/** Round to the implement's step. `down` for anything a ceiling must hold. */
export function roundLoad(
  value: number,
  exercise: string,
  unit: WeightUnit,
  mode: "nearest" | "down" = "nearest",
): number {
  const step = loadIncrement(exercise, unit);
  const steps = mode === "down" ? Math.floor(value / step + 1e-9) : Math.round(value / step);
  return Math.round(steps * step * 100) / 100;
}

/** Reps in reserve for an RPE target: RPE 8 leaves two. */
export function rirFor(rpe: number): number {
  return Math.max(0, 10 - rpe);
}

/**
 * The load an estimated 1RM implies for `reps` at `rpe`: Epley solved for
 * weight, counting the reserve as reps the athlete could still do. 5 reps at
 * RPE 8 is the weight of a 7-rep max — 81% of 1RM, the same answer as the RPE
 * charts coaches prescribe from.
 */
export function loadForReps(e1rm: number, reps: number, rpe: number): number {
  return e1rm / (1 + (reps + rirFor(rpe)) / 30);
}

/** The effort a load implies for `reps` against an estimated 1RM: loadForReps inverted. */
export function impliedRpe(e1rm: number, reps: number, load: number): number {
  return 10 - (30 * (e1rm / load - 1) - reps);
}

export interface StrengthEstimate {
  readonly exercise: string;
  /** Estimated 1RM in the athlete's weight unit. */
  readonly e1rm: number;
  /** The logged set behind the estimate, so the prompt can show its evidence. */
  readonly basis: { readonly date: string; readonly weight: number; readonly reps: number };
  readonly sessions: number;
}

interface SessionBest {
  readonly date: string;
  readonly e1rm: number;
  readonly weight: number;
  readonly reps: number;
}

function setEstimate(set: EngineSet, weight: number): number | null {
  const reps = set.reps ?? 0;
  if (reps < 1 || reps > MAX_ESTIMATE_REPS || weight <= 0) return null;
  // A set that fell short of what was prescribed was, by definition, a max.
  const shortOfPlan = set.plannedReps != null && reps < set.plannedReps;
  return epley(weight, reps + (shortOfPlan ? 0 : ASSUMED_RIR));
}

function collectSessionBests(
  sets: readonly EngineSet[],
  unit: WeightUnit,
): Map<string, Map<string, SessionBest>> {
  const byExercise = new Map<string, Map<string, SessionBest>>();
  for (const set of sets) {
    if (set.weight == null || !set.date) continue;
    if (implementFor(set.exerciseName) === "bodyweight") continue;
    const weight = storedWeightToDisplay(
      set.weight,
      { weightUnit: set.weightUnit },
      { weightUnit: unit },
    );
    const e1rm = setEstimate(set, weight);
    if (e1rm == null) continue;
    let sessions = byExercise.get(set.exerciseName);
    if (!sessions) {
      sessions = new Map();
      byExercise.set(set.exerciseName, sessions);
    }
    const sessionId = `${set.workoutLogId ?? ""}|${set.date}`;
    const best = sessions.get(sessionId);
    if (!best || e1rm > best.e1rm) {
      sessions.set(sessionId, { date: set.date, e1rm, weight, reps: set.reps ?? 0 });
    }
  }
  return byExercise;
}

/**
 * The athlete's current strength on each lift they have logged at least twice.
 *
 * Per session, the best set's estimate; across sessions, the BEST of the last
 * four — a plan starts from where the athlete is now, and an athlete who is
 * progressing is best described by their latest good day. Unless that best
 * stands more than 10% clear of the next: one mistyped 1000 kg, or one day
 * they felt unbeatable, must not set every load in the plan, so an outlier
 * falls back to the second-best.
 */
export function estimateStrength(
  sets: readonly EngineSet[],
  unit: WeightUnit,
): Map<string, StrengthEstimate> {
  const estimates = new Map<string, StrengthEstimate>();
  for (const [exercise, sessions] of collectSessionBests(sets, unit)) {
    if (sessions.size < MIN_SESSIONS) continue;
    const recent = [...sessions.values()]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, RECENT_SESSIONS)
      .sort((a, b) => b.e1rm - a.e1rm);
    const [best, second] = recent;
    if (!best || !second) continue;
    const chosen = best.e1rm > second.e1rm * (1 + OUTLIER_MARGIN) ? second : best;
    estimates.set(exercise, {
      exercise,
      e1rm: Math.round(chosen.e1rm * 10) / 10,
      basis: { date: chosen.date, weight: chosen.weight, reps: chosen.reps },
      sessions: sessions.size,
    });
  }
  return estimates;
}
