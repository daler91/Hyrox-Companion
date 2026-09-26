/**
 * Week-by-week targets for the plan's primary lifts: sets, reps, effort, rest
 * and — when the athlete has logged the lift — the load, computed from their
 * own estimated 1RM.
 *
 * This is the part of a plan a model is worst at and a spreadsheet is best at.
 * Left to the model, every chunk of a plan guessed its own loads (parallel
 * calls cannot see each other), phases changed rep schemes arbitrarily, and a
 * week after a deload came back wherever the model felt like. Here the whole
 * trajectory is decided up front from four inputs — the goal lens, the
 * experience level, the blueprint's phase/deload/block outline, and the
 * athlete's estimated 1RM — so every chunk prescribes the same numbers.
 *
 * The shape is block periodisation. Each phase has a rep scheme for the goal
 * (a runner's strength work stays at 5-8 reps, a strength athlete's peaks at
 * triples). Inside a block the load climbs ~2.5% a week from an opening effort
 * until it reaches the phase's effort ceiling; a deload halves the sets at
 * ~90% of the load; the next block reopens a little lighter on a slightly
 * higher estimated 1RM — the wave every block programme rides. Loads never
 * step up more than a plate or 7.5% in a week, under the 8% ceiling
 * planGenerationService clamps to, so the clamp has nothing to correct in a
 * target that was followed.
 */
import type { TrainingPhase } from "@shared/nutritionTargets";
import type { ExerciseName } from "@shared/schema/exercises";
import type { WeightUnit } from "@shared/unitConversion";

import type { ExperienceLevel, GoalLens, PrimarySlot } from "../ai/exerciseKnowledge";
import type { PlanWeekOutline } from "../planBlueprint";
import {
  implementFor,
  impliedRpe,
  loadForReps,
  loadIncrement,
  roundLoad,
  type StrengthEstimate,
} from "./loadMath";

export interface StrengthPrescription {
  readonly sets: number;
  readonly reps: number;
  readonly rpe: number;
}

export interface LiftWeekTarget extends StrengthPrescription {
  readonly week: number;
  readonly phase: TrainingPhase;
  readonly deload: boolean;
  /** Working load in the athlete's unit; null = prescribe by effort. */
  readonly load: number | null;
  readonly rest: { readonly minSec: number; readonly maxSec: number };
}

export interface LiftProgram {
  readonly slot: PrimarySlot;
  readonly exercise: ExerciseName;
  /** Null when the athlete has not logged this lift: targets are effort-only. */
  readonly estimate: StrengthEstimate | null;
  readonly weeks: readonly LiftWeekTarget[];
}

interface PhaseScheme {
  readonly sets: number;
  readonly reps: number;
  /** Effort of a block's opening week in this phase. */
  readonly rpeStart: number;
  /** The effort the block's climb stops at. */
  readonly rpeEnd: number;
}

type SchemeTable = Readonly<Record<TrainingPhase, PhaseScheme>>;

/**
 * Rep schemes per goal and phase. What differs by goal is where the reps
 * settle: strength work for a runner or a HYROX athlete exists for durability
 * and cheaper stations, so it never drops below 5 reps; a strength athlete's
 * peak is heavy triples. Each phase-to-phase change is sized to stay inside the
 * weekly load ceiling from the effort the previous phase ends on.
 */
const SCHEMES: Readonly<Record<GoalLens, SchemeTable>> = {
  strength: {
    early: { sets: 4, reps: 6, rpeStart: 7, rpeEnd: 8.5 },
    build: { sets: 5, reps: 4, rpeStart: 7.5, rpeEnd: 9 },
    peak: { sets: 5, reps: 3, rpeStart: 8, rpeEnd: 9 },
    taper: { sets: 3, reps: 2, rpeStart: 7.5, rpeEnd: 7.5 },
    race_week: { sets: 2, reps: 2, rpeStart: 7, rpeEnd: 7 },
  },
  hybrid: {
    early: { sets: 4, reps: 6, rpeStart: 7, rpeEnd: 8.5 },
    build: { sets: 4, reps: 5, rpeStart: 7.5, rpeEnd: 8.5 },
    peak: { sets: 3, reps: 4, rpeStart: 8, rpeEnd: 8.5 },
    taper: { sets: 3, reps: 3, rpeStart: 7, rpeEnd: 7 },
    race_week: { sets: 2, reps: 3, rpeStart: 6, rpeEnd: 6 },
  },
  hyrox: {
    early: { sets: 4, reps: 8, rpeStart: 7, rpeEnd: 8.5 },
    build: { sets: 4, reps: 6, rpeStart: 7.5, rpeEnd: 8.5 },
    peak: { sets: 3, reps: 5, rpeStart: 7.5, rpeEnd: 8 },
    taper: { sets: 2, reps: 5, rpeStart: 7, rpeEnd: 7 },
    race_week: { sets: 2, reps: 5, rpeStart: 6, rpeEnd: 6 },
  },
  running: {
    early: { sets: 3, reps: 8, rpeStart: 7, rpeEnd: 8 },
    build: { sets: 3, reps: 6, rpeStart: 7.5, rpeEnd: 8.5 },
    peak: { sets: 3, reps: 5, rpeStart: 7.5, rpeEnd: 8 },
    taper: { sets: 2, reps: 5, rpeStart: 7, rpeEnd: 7 },
    race_week: { sets: 2, reps: 5, rpeStart: 6, rpeEnd: 6 },
  },
  weight_loss: {
    early: { sets: 3, reps: 10, rpeStart: 7, rpeEnd: 8 },
    build: { sets: 4, reps: 8, rpeStart: 7.5, rpeEnd: 8.5 },
    peak: { sets: 4, reps: 6, rpeStart: 8, rpeEnd: 8.5 },
    taper: { sets: 3, reps: 8, rpeStart: 7, rpeEnd: 7 },
    race_week: { sets: 2, reps: 8, rpeStart: 6.5, rpeEnd: 6.5 },
  },
  general: {
    early: { sets: 3, reps: 10, rpeStart: 7, rpeEnd: 8 },
    build: { sets: 4, reps: 8, rpeStart: 7.5, rpeEnd: 8.5 },
    peak: { sets: 4, reps: 6, rpeStart: 8, rpeEnd: 8.5 },
    taper: { sets: 3, reps: 6, rpeStart: 7, rpeEnd: 7 },
    race_week: { sets: 2, reps: 6, rpeStart: 6.5, rpeEnd: 6.5 },
  },
};

/** The effort ceiling and rep floor each experience level trains inside. */
const EXPERIENCE_LIMITS: Readonly<
  Record<
    ExperienceLevel,
    { readonly maxRpe: number; readonly minReps: number; readonly maxSets: number }
  >
> = {
  beginner: { maxRpe: 8, minReps: 5, maxSets: 4 },
  intermediate: { maxRpe: 9, minReps: 3, maxSets: 5 },
  advanced: { maxRpe: 9.5, minReps: 2, maxSets: 5 },
};

/**
 * Weekly growth assumed for the estimated 1RM across loading weeks. Modest on
 * purpose: the plan is a forecast, and the auto-coach's progression updater
 * corrects it from what the athlete actually lifts. Beginners gain fastest.
 */
const WEEKLY_E1RM_GROWTH: Readonly<Record<ExperienceLevel, number>> = {
  beginner: 0.0075,
  intermediate: 0.004,
  advanced: 0.002,
};
/** However long the plan, never forecast more than this much stronger. */
const MAX_E1RM_GROWTH = 0.1;
/** How much a block's load climbs each week until it meets the effort ceiling. */
const WEEKLY_LOAD_CLIMB = 0.025;
/** Rounding up may overshoot the effort ceiling by this much; beyond it, round down. */
const RPE_ROUNDING_TOLERANCE = 0.25;
/** Week-over-week load ceiling, kept under planGenerationService's 8%. */
const MAX_WEEKLY_LOAD_STEP = 0.075;
/**
 * A lift's second exposure in a week (Strength C, Lower B's squat) runs the
 * same sets and reps at this fraction of the week's target load.
 */
export const LIGHT_EXPOSURE_FRACTION = 0.9;
/** A deload keeps ~90% of the load and about half the sets. */
const DELOAD_LOAD_FRACTION = 0.9;
const DELOAD_RPE = 6;

/** Heavy pulls from the floor degrade past 6 reps; a set of 8 becomes a back-rounding contest. */
const FLOOR_PULLS: ReadonlySet<string> = new Set<ExerciseName>([
  "deadlift",
  "sumo_deadlift",
  "trap_bar_deadlift",
  "deficit_deadlift",
  "rack_pull",
]);
const FLOOR_PULL_MAX_REPS = 6;

/** Lifts that stop making sense below a rep count, whatever the phase asks. */
const EXERCISE_MIN_REPS: Readonly<Partial<Record<ExerciseName, number>>> = {
  romanian_deadlift: 5,
  stiff_leg_deadlift: 6,
  hip_thrust: 6,
  kettlebell_swings: 12,
  goblet_squat: 6,
  leg_press: 6,
  hack_squat: 5,
  belt_squat: 5,
  lat_pulldown: 6,
  seated_cable_row: 8,
  chest_supported_row: 6,
  single_arm_dumbbell_row: 6,
  bent_over_row: 5,
  t_bar_row: 5,
  dumbbell_bench_press: 5,
  incline_dumbbell_bench_press: 5,
  seated_dumbbell_press: 5,
  arnold_press: 6,
  landmine_press: 5,
  kettlebell_press: 5,
  push_up: 6,
};

/** Sets and reps for one lift in one phase: the goal's scheme, shaped by slot, lift and experience. */
function liftShape(
  scheme: PhaseScheme,
  ctx: LiftContext,
  phase: TrainingPhase,
): { sets: number; reps: number } {
  const limits = EXPERIENCE_LIMITS[ctx.experience];
  // An advanced strength athlete's peak is doubles, not triples.
  const advancedPeak = ctx.experience === "advanced" && ctx.lens === "strength" && phase === "peak";
  let sets = scheme.sets;
  let reps = advancedPeak ? scheme.reps - 1 : scheme.reps;

  if (ctx.slot === "calves") {
    // Calves are volume-and-control work in every phase.
    sets = Math.min(sets, 3);
    reps = 12;
  } else if (ctx.slot === "single_leg") {
    // Two reps above the phase's scheme, on an even count (per side), 6-12.
    const raised = reps + 2;
    sets = Math.min(sets, 3);
    reps = Math.min(12, Math.max(6, raised + (raised % 2)));
  } else {
    reps = Math.max(reps, EXERCISE_MIN_REPS[ctx.exercise] ?? 1);
    if (FLOOR_PULLS.has(ctx.exercise)) reps = Math.min(reps, FLOOR_PULL_MAX_REPS);
  }

  return { sets: Math.min(sets, limits.maxSets), reps: Math.max(reps, limits.minReps) };
}

export function restFor(reps: number): { minSec: number; maxSec: number } {
  if (reps <= 3) return { minSec: 180, maxSec: 240 };
  if (reps <= 6) return { minSec: 120, maxSec: 180 };
  if (reps <= 10) return { minSec: 90, maxSec: 120 };
  return { minSec: 60, maxSec: 90 };
}

function isLoadingWeek(entry: PlanWeekOutline): boolean {
  return (
    !entry.deload && (entry.phase === "early" || entry.phase === "build" || entry.phase === "peak")
  );
}

function roundHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

interface LiftContext {
  readonly slot: PrimarySlot;
  readonly exercise: ExerciseName;
  readonly lens: GoalLens;
  readonly experience: ExperienceLevel;
  readonly unit: WeightUnit;
  readonly e1rm: number | null;
}

/** What the walk carries from one week to the next. */
interface WalkState {
  loadingWeeksDone: number;
  /** The last non-deload week's target: the basis for the ceiling and for deloads. */
  lastLoading: LiftWeekTarget | null;
  /** The current (block, phase) run, the week's index in it, and its opening load. */
  runKey: string;
  runIndex: number;
  runOpening: number | null;
}

function capToWeeklyStep(load: number, previous: number | null, ctx: LiftContext): number {
  if (previous == null) return load;
  // One real plate step is always allowed — on a 20 kg dumbbell the smallest
  // possible jump is 10%, and forbidding it would freeze the lift for good.
  const ceiling = Math.max(
    roundLoad(previous * (1 + MAX_WEEKLY_LOAD_STEP), ctx.exercise, ctx.unit, "down"),
    previous + loadIncrement(ctx.exercise, ctx.unit),
  );
  return Math.min(load, ceiling);
}

function deloadWeek(
  entry: PlanWeekOutline,
  basis: LiftWeekTarget | null,
  ctx: LiftContext,
): LiftWeekTarget {
  const reference =
    basis ??
    loadingTarget(entry, ctx, {
      loadingWeeksDone: 0,
      lastLoading: null,
      runKey: "",
      runIndex: 0,
      runOpening: null,
    });
  const load =
    reference.load == null
      ? null
      : roundLoad(reference.load * DELOAD_LOAD_FRACTION, ctx.exercise, ctx.unit, "down");
  return {
    week: entry.week,
    phase: entry.phase,
    deload: true,
    sets: Math.max(1, Math.round(reference.sets / 2)),
    reps: reference.reps,
    rpe: DELOAD_RPE,
    load: load != null && load > 0 ? load : null,
    rest: restFor(reference.reps),
  };
}

/**
 * The load for one week of a block: the run's opening load climbed 2.5% a
 * week, stopped at the phase's effort ceiling, rounded to the implement, and
 * held to the weekly step. The effort shown is the one that load actually
 * implies against the forecast 1RM, so a week that rounding held flat reads
 * as the same effort rather than a made-up climb.
 */
function weekLoad(
  ctx: LiftContext & { readonly e1rm: number },
  reps: number,
  rpeRange: { readonly start: number; readonly end: number },
  state: WalkState,
): { load: number | null; rpe: number } {
  const growth = Math.min(
    MAX_E1RM_GROWTH,
    WEEKLY_E1RM_GROWTH[ctx.experience] * state.loadingWeeksDone,
  );
  const e1rm = ctx.e1rm * (1 + growth);
  if (state.runIndex === 0 || state.runOpening == null) {
    state.runOpening = loadForReps(e1rm, reps, rpeRange.start);
  }
  const raw = Math.min(
    state.runOpening * (1 + WEEKLY_LOAD_CLIMB * state.runIndex),
    loadForReps(e1rm, reps, rpeRange.end),
  );
  let load = roundLoad(raw, ctx.exercise, ctx.unit);
  // Rounding up to the next plate may cost a little effort — but a block's
  // opening week stays near its opening effort, not at the ceiling.
  const roundingCeiling =
    state.runIndex === 0 ? rpeRange.start + 0.5 : rpeRange.end + RPE_ROUNDING_TOLERANCE;
  if (impliedRpe(e1rm, reps, load) > roundingCeiling) {
    load = roundLoad(raw, ctx.exercise, ctx.unit, "down");
  }
  const previous = state.lastLoading?.load ?? null;
  load = capToWeeklyStep(load, previous, ctx);
  // Inside a run the load never goes backwards; rounding may only hold it.
  if (state.runIndex > 0 && previous != null) load = Math.max(load, previous);
  if (load <= 0) return { load: null, rpe: rpeRange.start };
  const rpe = Math.min(
    rpeRange.end,
    Math.max(rpeRange.start, roundHalf(impliedRpe(e1rm, reps, load))),
  );
  return { load, rpe };
}

function loadingTarget(entry: PlanWeekOutline, ctx: LiftContext, state: WalkState): LiftWeekTarget {
  const scheme = SCHEMES[ctx.lens][entry.phase];
  const maxRpe = EXPERIENCE_LIMITS[ctx.experience].maxRpe;
  const rpeRange = {
    start: Math.min(scheme.rpeStart, maxRpe),
    end: Math.min(scheme.rpeEnd, maxRpe),
  };
  const { sets, reps } = liftShape(scheme, ctx, entry.phase);

  const loaded = ctx.e1rm != null && implementFor(ctx.exercise) !== "bodyweight";
  const { load, rpe } = loaded
    ? weekLoad({ ...ctx, e1rm: ctx.e1rm }, reps, rpeRange, state)
    : // Effort-only: no load to climb, so the effort climbs half an RPE a week instead.
      { load: null, rpe: Math.min(rpeRange.end, rpeRange.start + 0.5 * state.runIndex) };

  return {
    week: entry.week,
    phase: entry.phase,
    deload: false,
    sets,
    reps,
    rpe,
    load,
    rest: restFor(reps),
  };
}

function buildLiftWeeks(outline: readonly PlanWeekOutline[], ctx: LiftContext): LiftWeekTarget[] {
  const state: WalkState = {
    loadingWeeksDone: 0,
    lastLoading: null,
    runKey: "",
    runIndex: 0,
    runOpening: null,
  };
  const weeks: LiftWeekTarget[] = [];
  for (const entry of outline) {
    if (entry.deload) {
      weeks.push(deloadWeek(entry, state.lastLoading, ctx));
      continue;
    }
    const runKey = `${entry.block}:${entry.phase}`;
    state.runIndex = runKey === state.runKey ? state.runIndex + 1 : 0;
    state.runKey = runKey;
    const target = loadingTarget(entry, ctx, state);
    weeks.push(target);
    state.lastLoading = target;
    if (isLoadingWeek(entry)) state.loadingWeeksDone += 1;
  }
  return weeks;
}

export interface LiftProgramInput {
  readonly lens: GoalLens;
  readonly experience: ExperienceLevel;
  readonly unit: WeightUnit;
  readonly outline: readonly PlanWeekOutline[];
  readonly primaryLifts: readonly { readonly slot: PrimarySlot; readonly exercise: ExerciseName }[];
  /** From estimateStrength, keyed by exercise. */
  readonly estimates: ReadonlyMap<string, StrengthEstimate>;
}

/** Every primary lift's targets for every week of the plan. */
export function buildLiftPrograms(input: LiftProgramInput): LiftProgram[] {
  return input.primaryLifts.map(({ slot, exercise }) => {
    const estimate = input.estimates.get(exercise) ?? null;
    const ctx: LiftContext = {
      slot,
      exercise,
      lens: input.lens,
      experience: input.experience,
      unit: input.unit,
      e1rm: estimate?.e1rm ?? null,
    };
    return { slot, exercise, estimate, weeks: buildLiftWeeks(input.outline, ctx) };
  });
}
