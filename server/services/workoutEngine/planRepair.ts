/**
 * Post-generation repair: the model's primary-lift sets snapped back to the
 * engine's targets.
 *
 * The prompt asks for the targets verbatim, and a model mostly obliges — but
 * "mostly" across a 24-week plan is dozens of drifted numbers (a 4x8 written
 * as 3x10, a load rounded to the model's taste, a set list that ramps where
 * the target is straight sets). The engine's numbers are the plan's backbone:
 * the progression updater reads them back later and the clamp reasons about
 * them, so they are enforced here rather than trusted.
 *
 * Only primary lifts, only structured sets plus the one text line that
 * describes each: everything else the model wrote stands. The first time a
 * lift appears in a week it gets the week's target; a second appearance is
 * the lighter exposure (same sets and reps at ~90%).
 */
import { PLAN_WEEKDAYS } from "@shared/dateUtils";
import { knownExerciseLabel } from "@shared/schema/exercises";
import type { WeightUnit } from "@shared/unitConversion";

import type { WorkoutEnginePlan } from "./enginePlan";
import { roundLoad } from "./loadMath";
import { type LiftProgram, type LiftWeekTarget, LIGHT_EXPOSURE_FRACTION } from "./strength";
import { replaceFirstValue } from "./textScan";

export interface RepairableSet {
  setNumber?: number | null;
  reps?: number | null;
  weight?: number | null;
  weightUnit?: string | null;
  notes?: string | null;
}

export interface RepairableExercise {
  exerciseName: string;
  sets: RepairableSet[];
}

export interface RepairableDay {
  weekNumber: number;
  dayName: string;
  mainWorkout: string;
  accessory?: string | null;
  exercises: RepairableExercise[] | null;
}

export interface LiftRepair {
  readonly exercise: string;
  readonly weekNumber: number;
  readonly dayName: string;
}

export interface LiftPrescription {
  readonly sets: number;
  readonly reps: number;
  readonly load: number | null;
  readonly effort: string;
  readonly rest: string;
}

function restText(rest: LiftWeekTarget["rest"]): string {
  return rest.maxSec <= 120
    ? `${rest.minSec}-${rest.maxSec} s`
    : `${rest.minSec / 60}-${rest.maxSec / 60} min`;
}

function prescriptionFor(
  program: LiftProgram,
  target: LiftWeekTarget,
  light: boolean,
  unit: WeightUnit,
): LiftPrescription {
  const load =
    target.load == null || !light
      ? target.load
      : roundLoad(target.load * LIGHT_EXPOSURE_FRACTION, program.exercise, unit, "down");
  return {
    sets: target.sets,
    reps: target.reps,
    load,
    effort: light ? `RPE ~${Math.max(6, target.rpe - 2)}` : `RPE ${target.rpe}`,
    rest: restText(target.rest),
  };
}

function setsMatch(
  sets: readonly RepairableSet[],
  want: LiftPrescription,
  unit: WeightUnit,
): boolean {
  if (sets.length !== want.sets) return false;
  return sets.every(
    (set) =>
      set.reps === want.reps &&
      (want.load == null || (set.weight === want.load && (set.weightUnit ?? unit) === unit)),
  );
}

/** Straight sets at the target; an effort-only lift keeps the model's weights. */
function repairSets(
  exercise: RepairableExercise,
  want: LiftPrescription,
  unit: WeightUnit,
): boolean {
  if (setsMatch(exercise.sets, want, unit)) return false;
  const original = exercise.sets;
  exercise.sets = Array.from({ length: want.sets }, (_, index): RepairableSet => {
    const base = original[Math.min(index, original.length - 1)] ?? {};
    const set: RepairableSet = { setNumber: index + 1, reps: want.reps };
    if (want.load != null) {
      set.weight = want.load;
      set.weightUnit = unit;
    } else if (base.weight != null) {
      set.weight = base.weight;
      if (base.weightUnit != null) set.weightUnit = base.weightUnit;
    }
    if (index === 0) set.notes = `${want.effort} · rest ${want.rest}`;
    return set;
  });
  return true;
}

// Where each number on a lift's line starts ("4x" of "4x6", "@ " of "@ 80 kg",
// "RPE " of "RPE 7-8"); replaceFirstValue reads the number or range after it.
const SETS_REPS = /\b\d+\s*[x×]\s*/gi;
const WORD_END = /\b/y;
const AT_LOAD = /@\s*/g;
const LOAD_UNIT = /\s*(?:kg|lbs?)\b/iy;
const RPE = /RPE[\s~]*/gi;

function exerciseNames(exercise: string): string[] {
  const label = knownExerciseLabel(exercise);
  return [label, exercise.replaceAll("_", " ")].filter((name): name is string => Boolean(name));
}

/** Apply `edit` to the first line of `text` that names the exercise; every other line is untouched. */
function rewriteExerciseLine(
  text: string,
  exercise: string,
  edit: (line: string) => string,
): string {
  const names = exerciseNames(exercise).map((name) => name.toLowerCase());
  const lines = text.split("\n");
  const index = lines.findIndex((line) => names.some((name) => line.toLowerCase().includes(name)));
  if (index < 0) return text;
  return lines.map((line, at) => (at === index ? edit(line) : line)).join("\n");
}

/**
 * Rewrite the numbers on the first line of `text` that names the exercise, so
 * the session as written agrees with its table. A line whose numbers the
 * patterns don't recognise is left as the model wrote it.
 */
export function rewriteLiftLine(
  text: string,
  exercise: string,
  want: LiftPrescription,
  unit: WeightUnit,
): string {
  return rewriteExerciseLine(text, exercise, (line) => {
    let rewritten = replaceFirstValue(line, SETS_REPS, `${want.sets}x${want.reps}`, WORD_END);
    if (want.load != null) {
      rewritten = replaceFirstValue(rewritten, AT_LOAD, `@ ${want.load} ${unit}`, LOAD_UNIT);
    }
    return replaceFirstValue(rewritten, RPE, want.effort);
  });
}

/** Only the load on the exercise's line: what an adaptation changes. */
export function rewriteLiftLoad(
  text: string,
  exercise: string,
  load: number,
  unit: string,
): string {
  return rewriteExerciseLine(text, exercise, (line) =>
    replaceFirstValue(line, AT_LOAD, `@ ${load} ${unit}`, LOAD_UNIT),
  );
}

function dayOrder(day: RepairableDay): number {
  return PLAN_WEEKDAYS.indexOf(day.dayName as (typeof PLAN_WEEKDAYS)[number]);
}

function repairWeek(
  weekDays: readonly RepairableDay[],
  program: LiftProgram,
  engine: WorkoutEnginePlan,
  repairs: LiftRepair[],
): void {
  const week = weekDays.at(0)?.weekNumber;
  const target = week == null ? undefined : program.weeks.at(week - 1);
  if (!target) return;
  let exposures = 0;
  for (const day of weekDays) {
    const matching = (day.exercises ?? []).filter(
      (entry) => entry.exerciseName === program.exercise,
    );
    if (matching.length === 0) continue;
    const want = prescriptionFor(program, target, exposures > 0, engine.weightUnit);
    exposures += 1;
    let changed = false;
    for (const entry of matching) changed = repairSets(entry, want, engine.weightUnit) || changed;
    if (!changed) continue;
    day.mainWorkout = rewriteLiftLine(day.mainWorkout, program.exercise, want, engine.weightUnit);
    if (day.accessory) {
      day.accessory = rewriteLiftLine(day.accessory, program.exercise, want, engine.weightUnit);
    }
    repairs.push({ exercise: program.exercise, weekNumber: day.weekNumber, dayName: day.dayName });
  }
}

/**
 * Snap every primary lift in the generated days to the engine's week target,
 * in place, and report what moved. Race week (with a race) is left as the
 * model wrote it: its primers are optional by design.
 */
export function repairPrimaryLifts(
  days: readonly RepairableDay[],
  engine: WorkoutEnginePlan | null | undefined,
): LiftRepair[] {
  if (!engine || engine.lifts.length === 0) return [];
  const byWeek = new Map<number, RepairableDay[]>();
  for (const day of days) {
    if (engine.hasRace && day.weekNumber === engine.totalWeeks) continue;
    const list = byWeek.get(day.weekNumber) ?? [];
    list.push(day);
    byWeek.set(day.weekNumber, list);
  }
  const repairs: LiftRepair[] = [];
  for (const weekDays of byWeek.values()) {
    weekDays.sort((a, b) => dayOrder(a) - dayOrder(b));
    for (const program of engine.lifts) repairWeek(weekDays, program, engine, repairs);
  }
  return repairs;
}
