/**
 * Adapting a plan to what the athlete actually did.
 *
 * A generated plan is a forecast. Every logged session is evidence against it,
 * and this module turns that evidence into changes to the sessions still to
 * come — the part of coaching that happens between the sessions, the way a
 * coach reads a training log:
 *
 *   - Beat the prescription (more reps, more load)  → the lift's upcoming loads
 *     rise by what the session showed, at most 5% per session.
 *   - Met it but it felt easy (session RPE ≤ 6)     → one step up.
 *   - Met it but it was a grind (session RPE ≥ 9)   → hold: the next session
 *     repeats the load instead of climbing, then progression resumes.
 *   - Fell short                                   → hold at the missed load.
 *   - Fell short of the SAME prescription twice     → deload 10% and rebuild —
 *     the rule the workout detail's "Next" chip applies (shared/progression.ts),
 *     so the chip and the plan never disagree.
 *   - A run that is a new best effort               → every written pace in the
 *     plan moves to the new fitness (paceRewrite.ts).
 *
 * Guardrails, because an adaptation that hurts someone is worse than none:
 * nothing rises while the load governor reports fatigue or inside a taper or
 * race week; a hold or deload only ever lowers weights; one unusual session
 * moves loads by at most +5% / -10%; each logged workout is applied once
 * (tracked in the plan's engine state); and days the load governor already
 * rewrote this pass are left alone.
 *
 * Pure: the caller loads the history and the upcoming days and persists the
 * result (coachService). Deterministic: the same inputs give the same plan.
 */
import { addDaysToISODate, dayDiff, PLAN_WEEKDAYS, weekdayIndex } from "@shared/dateUtils";
import type { TrainingPhase } from "@shared/nutritionTargets";
import { computePlanPhase } from "@shared/planPhase";
import { epley, unmetPrescription } from "@shared/progression";
import type { CoachNoteInputs, PlanEngineState } from "@shared/schema";
import { EXERCISE_DEFINITIONS, type ExerciseName } from "@shared/schema/exercises";
import { storedWeightToDisplay, type WeightUnit } from "@shared/unitConversion";

import { ASSUMED_RIR, implementFor, roundLoad } from "./loadMath";
import { rescalePaces } from "./paceRewrite";
import { rewriteLiftLoad } from "./planRepair";
import { buildRunPaceZones, collectRunEfforts, type EngineRunLog, paceAtFraction } from "./running";

// ---------------------------------------------------------------------------
// Inputs and outputs
// ---------------------------------------------------------------------------

export interface AdaptationLog extends EngineRunLog {
  readonly id: string;
  /** Session RPE the athlete logged, 1-10. */
  readonly rpe?: number | null;
}

export interface AdaptationSet {
  readonly workoutLogId: string;
  readonly date: string;
  readonly exerciseName: string;
  readonly category?: string | null;
  readonly setNumber?: number | null;
  readonly reps?: number | null;
  readonly weight?: number | null;
  readonly weightUnit?: string | null;
  readonly plannedReps?: number | null;
  readonly plannedWeight?: number | null;
  readonly distance?: number | null;
  readonly distanceUnit?: string | null;
  readonly time?: number | null;
}

export interface AdaptablePlanSet {
  readonly id: string;
  readonly exerciseName: string;
  readonly reps?: number | null;
  readonly weight?: number | null;
  readonly weightUnit?: string | null;
  readonly notes?: string | null;
}

export interface AdaptablePlanDay {
  readonly id: string;
  readonly date: string;
  readonly weekNumber: number;
  readonly mainWorkout: string;
  readonly accessory?: string | null;
  readonly notes?: string | null;
  readonly aiInputsUsed?: CoachNoteInputs | null;
  readonly sets: readonly AdaptablePlanSet[];
}

export interface AdaptationInput {
  readonly today: string;
  /** ISO timestamp stamped on the state and the audit trail. */
  readonly now: string;
  readonly weightUnit: WeightUnit;
  readonly distanceUnit: string;
  readonly plan: {
    readonly startDate?: string | null;
    readonly totalWeeks: number;
    readonly engineState: PlanEngineState | null;
  };
  /** The athlete's recent workout logs (~10 weeks), training or not. */
  readonly logs: readonly AdaptationLog[];
  /** Their logged sets over the same window. */
  readonly sets: readonly AdaptationSet[];
  /** The plan's remaining planned days, soonest first. */
  readonly upcoming: readonly AdaptablePlanDay[];
  /** The load governor reports fatigue: nothing may rise this pass. */
  readonly fatigued: boolean;
  /** Days another stage already rewrote this pass. */
  readonly excludedDayIds?: ReadonlySet<string>;
}

export type ProgressionChangeKind = "raise" | "hold" | "deload" | "pace";

export interface ProgressionChange {
  readonly exercise: string;
  readonly kind: ProgressionChangeKind;
  readonly from: number;
  readonly to: number;
  readonly unit: string;
}

export interface SetLoadUpdate {
  readonly setId: string;
  readonly weight?: number;
  readonly weightUnit?: string;
  readonly notes?: string;
}

export interface DayAdaptation {
  readonly planDayId: string;
  readonly setUpdates: readonly SetLoadUpdate[];
  readonly mainWorkout?: string;
  readonly accessory?: string | null;
  readonly notes?: string | null;
  readonly rationale: string;
  readonly inputsUsed: CoachNoteInputs;
  readonly changes: readonly ProgressionChange[];
}

export interface AdaptationResult {
  readonly days: readonly DayAdaptation[];
  readonly engineState: PlanEngineState;
  /** Logs adapted this pass. */
  readonly adaptedLogIds: readonly string[];
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Only logs this recent are adapted: an old session says little about next week. */
export const ADAPTATION_WINDOW_DAYS = 10;
/** Load changes reach this far ahead; later sessions follow as later logs arrive. */
const LOAD_HORIZON_DAYS = 21;
/** One session may lift the plan by at most this much. */
const MAX_RAISE = 0.05;
/** Surplus below this is noise, not a reason to move the plan. */
const MIN_SURPLUS = 0.02;
const EASY_SESSION_RAISE = 0.025;
const EASY_SESSION_RPE = 6;
const HARD_SESSION_RPE = 9;
const DELOAD_FRACTION = 0.1;
/** After a hold or deload, progression resumes at this rate per week. */
const RESUME_RATE_PER_WEEK = 0.025;
/** Epley holds for 1-12 reps; beyond that a set is conditioning, not a load test. */
const MAX_ADAPT_REPS = 12;
/** A new best must beat the plan's VDOT by this much before paces move. */
const MIN_VDOT_GAIN = 0.5;
/** And one pass moves paces by at most this much fitness. */
const MAX_VDOT_GAIN_FRACTION = 0.06;
const MAX_ADAPTED_LOG_IDS = 200;
/** A lift not trained for this long (and for twice its usual spacing) eases back in. */
const BREAK_DAYS = 14;
/** Beyond the first two weeks off, the return load drops this much per week off... */
const DETRAINING_PER_WEEK = 0.025;
/** ...down to at most this much below the last session. */
const MAX_DETRAINING = 0.1;
/** Only lifts trained regularly: a rarely rotated accessory has no habit to break. */
const MIN_SESSIONS_FOR_BREAK = 3;
const RATIONALE_MAX = 400;

// ---------------------------------------------------------------------------
// Working state
// ---------------------------------------------------------------------------

interface WorkingDay {
  readonly day: AdaptablePlanDay;
  readonly phase: TrainingPhase | undefined;
  /** Current weight of each set, in the athlete's unit, as adapted so far. */
  readonly weights: Map<string, number>;
  readonly touchedSets: Set<string>;
  mainWorkout: string;
  accessory: string | null;
  notes: string | null;
  readonly setNotes: Map<string, string>;
  readonly changes: ProgressionChange[];
  readonly reasons: string[];
}

function toWorkingDay(day: AdaptablePlanDay, input: AdaptationInput): WorkingDay {
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
    touchedSets: new Set(),
    mainWorkout: day.mainWorkout,
    accessory: day.accessory ?? null,
    notes: day.notes ?? null,
    setNotes: new Map(),
    changes: [],
    reasons: [],
  };
}

function exerciseLabel(exercise: string): string {
  return EXERCISE_DEFINITIONS[exercise as ExerciseName]?.label ?? exercise.replaceAll("_", " ");
}

function weekdayName(date: string): string {
  return PLAN_WEEKDAYS[weekdayIndex(date)] ?? date;
}

// ---------------------------------------------------------------------------
// Reading a logged session
// ---------------------------------------------------------------------------

interface LoggedSession {
  readonly log: AdaptationLog;
  readonly exercise: string;
  readonly sets: readonly AdaptationSet[];
}

type Decision =
  | { readonly kind: "raise"; readonly factor: number; readonly reason: string }
  | {
      readonly kind: "cap";
      readonly load: number;
      readonly reps: number;
      readonly deload: boolean;
      readonly reason: string;
      /** What the later sessions it reaches say; defaults to following the logged session. */
      readonly followUp?: string;
    }
  | { readonly kind: "catch_up"; readonly e1rm: number; readonly performed: string }
  | { readonly kind: "none" };

function inUnit(value: number, set: AdaptationSet, unit: WeightUnit): number {
  return storedWeightToDisplay(value, { weightUnit: set.weightUnit }, { weightUnit: unit });
}

/** Weighted strength sets Epley can read: 1-12 reps with a load. */
function isAdaptableSet(set: AdaptationSet): boolean {
  if (set.category != null && set.category !== "strength") return false;
  const reps = set.reps ?? 0;
  return (set.weight ?? 0) > 0 && reps >= 1 && reps <= MAX_ADAPT_REPS;
}

function describePerformed(sets: readonly AdaptationSet[], unit: WeightUnit): string {
  const weights = sets.map((set) => inUnit(set.weight ?? 0, set, unit));
  const reps = sets.map((set) => set.reps ?? 0);
  const top = Math.max(...weights);
  if (weights.every((weight) => weight === top) && reps.every((rep) => rep === reps[0])) {
    return `${sets.length}x${reps[0]} @ ${top} ${unit}`;
  }
  return `${top} ${unit} x ${reps.join(", ")}`;
}

/** The session's uniform prescription, in the athlete's unit, when it had one. */
function prescriptionOf(
  sets: readonly AdaptationSet[],
  unit: WeightUnit,
): { reps: number; weight: number; text: string } | null {
  const first = sets[0];
  if (!first || first.plannedReps == null || first.plannedWeight == null) return null;
  const uniform = sets.every(
    (set) => set.plannedReps === first.plannedReps && set.plannedWeight === first.plannedWeight,
  );
  if (!uniform || first.plannedWeight <= 0) return null;
  const weight = inUnit(first.plannedWeight, first, unit);
  return {
    reps: first.plannedReps,
    weight,
    text: `${sets.length}x${first.plannedReps} @ ${weight} ${unit}`,
  };
}

function bestE1rm(sets: readonly AdaptationSet[], unit: WeightUnit): number {
  return Math.max(
    ...sets.map((set) => epley(inUnit(set.weight ?? 0, set, unit), (set.reps ?? 0) + ASSUMED_RIR)),
  );
}

function decideMissed(
  session: LoggedSession,
  previous: readonly AdaptationSet[] | null,
  unit: WeightUnit,
): Decision | null {
  const unmet = unmetPrescription(session.sets);
  if (!unmet) return null;
  const first = session.sets[0];
  const load = inUnit(unmet.weight, first, unit);
  const planned = `${session.sets.length}x${unmet.reps} @ ${load} ${unit}`;
  const previousUnmet = previous ? unmetPrescription(previous) : null;
  const day = weekdayName(session.log.date);
  if (previousUnmet?.reps === unmet.reps && previousUnmet.weight === unmet.weight) {
    return {
      kind: "cap",
      load: load * (1 - DELOAD_FRACTION),
      reps: unmet.reps,
      deload: true,
      reason: `${planned} was missed twice in a row, so ${exerciseLabel(session.exercise)} steps back 10% to rebuild`,
    };
  }
  const reps = session.sets.map((set) => set.reps ?? 0).join(", ");
  return {
    kind: "cap",
    load,
    reps: unmet.reps,
    deload: false,
    reason: `${day}'s ${planned} fell short (${reps}), so ${exerciseLabel(session.exercise)} repeats that load before it climbs again`,
  };
}

/**
 * What one logged session says about the lift's upcoming sessions. Ad-hoc
 * work (nothing prescribed) can only pull the plan UP to what it showed — a
 * light session the athlete chose is not evidence of weakness.
 */
function decide(
  session: LoggedSession,
  previous: readonly AdaptationSet[] | null,
  unit: WeightUnit,
): Decision {
  const missed = decideMissed(session, previous, unit);
  if (missed) return missed;

  const performed = describePerformed(session.sets, unit);
  const prescription = prescriptionOf(session.sets, unit);
  if (!prescription) return { kind: "catch_up", e1rm: bestE1rm(session.sets, unit), performed };

  const day = weekdayName(session.log.date);
  const label = exerciseLabel(session.exercise);
  const rpe = session.log.rpe ?? null;
  if (rpe != null && rpe >= HARD_SESSION_RPE) {
    return {
      kind: "cap",
      load: prescription.weight,
      reps: prescription.reps,
      deload: false,
      reason: `${day}'s ${prescription.text} felt very hard (RPE ${rpe}), so ${label} repeats that load before it climbs`,
    };
  }
  const surplus =
    bestE1rm(session.sets, unit) / epley(prescription.weight, prescription.reps + ASSUMED_RIR);
  if (surplus >= 1 + MIN_SURPLUS) {
    return {
      kind: "raise",
      factor: Math.min(1 + MAX_RAISE, surplus),
      reason: `${day}'s ${performed} beat the planned ${prescription.text} — ${label} now builds from what you did`,
    };
  }
  if (rpe != null && rpe <= EASY_SESSION_RPE) {
    return {
      kind: "raise",
      factor: 1 + EASY_SESSION_RAISE,
      reason: `${day}'s ${prescription.text} felt easy (RPE ${rpe}) — ${label} takes a step up`,
    };
  }
  return { kind: "none" };
}

// ---------------------------------------------------------------------------
// Applying a decision to the upcoming sessions of the lift
// ---------------------------------------------------------------------------

function setsOf(day: WorkingDay, exercise: string): AdaptablePlanSet[] {
  return day.day.sets.filter((set) => set.exerciseName === exercise && day.weights.has(set.id));
}

function topWeight(day: WorkingDay, exercise: string): number {
  return Math.max(0, ...setsOf(day, exercise).map((set) => day.weights.get(set.id) ?? 0));
}

function repsOf(day: WorkingDay, exercise: string): number {
  const sets = setsOf(day, exercise);
  const top = topWeight(day, exercise);
  return sets.find((set) => day.weights.get(set.id) === top)?.reps ?? sets[0]?.reps ?? 5;
}

/** The load for `reps` that matches `load` for `fromReps` on the same effort. */
function equivalentLoad(load: number, fromReps: number, reps: number): number {
  return (load * (1 + (fromReps + ASSUMED_RIR) / 30)) / (1 + (reps + ASSUMED_RIR) / 30);
}

function canRise(day: WorkingDay): boolean {
  return day.phase !== "taper" && day.phase !== "race_week";
}

function recordChange(
  day: WorkingDay,
  exercise: string,
  kind: ProgressionChangeKind,
  from: number,
  unit: WeightUnit,
): void {
  const to = topWeight(day, exercise);
  if (to === from) return;
  day.changes.push({ exercise, kind, from, to, unit });
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
      const weight = day.weights.get(set.id)!;
      const raised = roundLoad(weight * factor, exercise, unit);
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
  const first = days[0];
  if (!first) return [];
  const changed: WorkingDay[] = [];
  for (const day of days) {
    const weeks = Math.max(0, dayDiff(first.day.date, day.day.date)) / 7;
    const cap = roundLoad(
      equivalentLoad(decision.load, decision.reps, repsOf(day, exercise)) *
        (1 + RESUME_RATE_PER_WEEK) ** weeks,
      exercise,
      unit,
      "down",
    );
    const before = topWeight(day, exercise);
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

interface ApplyContext {
  readonly unit: WeightUnit;
  readonly fatigued: boolean;
}

function applyDecision(
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

// ---------------------------------------------------------------------------
// Returning from a break
// ---------------------------------------------------------------------------

interface LiftHistory {
  /** Session dates, oldest first. */
  readonly dates: string[];
  /** The most recent session's top set, in the athlete's unit. */
  lastLoad: number;
  lastReps: number;
}

function liftHistories(sets: readonly AdaptationSet[], unit: WeightUnit): Map<string, LiftHistory> {
  const byExercise = new Map<string, Map<string, AdaptationSet[]>>();
  for (const set of sets) {
    if (!isAdaptableSet(set) || implementFor(set.exerciseName) === "bodyweight") continue;
    const sessions = byExercise.get(set.exerciseName) ?? new Map<string, AdaptationSet[]>();
    const key = `${set.date}|${set.workoutLogId}`;
    sessions.set(key, [...(sessions.get(key) ?? []), set]);
    byExercise.set(set.exerciseName, sessions);
  }
  const histories = new Map<string, LiftHistory>();
  for (const [exercise, sessions] of byExercise) {
    const keys = [...sessions.keys()].sort();
    const last = sessions.get(keys.at(-1)!)!;
    const top = last.reduce((best, set) =>
      inUnit(set.weight ?? 0, set, unit) > inUnit(best.weight ?? 0, best, unit) ? set : best,
    );
    histories.set(exercise, {
      dates: keys.map((key) => key.slice(0, 10)),
      lastLoad: inUnit(top.weight ?? 0, top, unit),
      lastReps: top.reps ?? 5,
    });
  }
  return histories;
}

/** The athlete's usual spacing between sessions of a lift, in days. */
function usualSpacing(dates: readonly string[]): number {
  const gaps = dates
    .slice(1)
    .map((date, index) => dayDiff(dates[index], date))
    .sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] ?? BREAK_DAYS;
}

/**
 * A lift the athlete has not trained for a while comes back below where they
 * left it, not where the plan kept climbing to in their absence: a squat last
 * done three weeks ago at 100 kg returns at ~97.5 kg rather than the 107.5 kg
 * the plan reached without them. Two weeks off costs nothing; each week beyond
 * costs 2.5%, to at most 10%, and progression resumes from there. Idempotent:
 * it only ever caps, so a second pass finds nothing left to lower.
 */
function applyReturnFromBreak(
  working: readonly WorkingDay[],
  input: AdaptationInput,
  horizonEnd: string,
): void {
  for (const [exercise, history] of liftHistories(input.sets, input.weightUnit)) {
    if (history.dates.length < MIN_SESSIONS_FOR_BREAK) continue;
    const targets = working.filter(
      (day) => day.day.date <= horizonEnd && setsOf(day, exercise).length > 0,
    );
    const first = targets[0];
    if (!first) continue;
    const lastDate = history.dates.at(-1)!;
    const gap = dayDiff(lastDate, first.day.date);
    if (gap < Math.max(BREAK_DAYS, 2 * usualSpacing(history.dates))) continue;
    const weeksOff = Math.floor(gap / 7);
    const drop = Math.min(MAX_DETRAINING, DETRAINING_PER_WEEK * Math.max(0, weeksOff - 2));
    const label = exerciseLabel(exercise);
    applyDecision(
      { log: { id: "break", date: lastDate }, exercise, sets: [] },
      {
        kind: "cap",
        load: history.lastLoad * (1 - drop),
        reps: history.lastReps,
        deload: false,
        reason: `it has been ${weeksOff} weeks since your last ${label} (${history.lastLoad} ${input.weightUnit} x ${history.lastReps}), so it eases back in below that and builds again`,
        followUp: `${label} keeps building from its return load`,
      },
      targets,
      { unit: input.weightUnit, fatigued: input.fatigued },
    );
  }
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

function paceClock(secondsPerKm: number, unit: string): string {
  const perUnit = unit === "miles" ? secondsPerKm * 1.609344 : secondsPerKm;
  const total = Math.round(perUnit);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}/${unit === "miles" ? "mi" : "km"}`;
}

interface RunUpdate {
  readonly from: number;
  readonly to: number;
  readonly reason: string;
}

/**
 * A new best effort in the logs being adapted moves the plan's paces. The
 * fitness comes from buildRunPaceZones over the whole history, not from the
 * one run, so a GPS glitch or a mis-tagged ride is rejected the same way it
 * is at generation.
 */
function decideRunUpdate(
  input: AdaptationInput,
  newLogIds: ReadonlySet<string>,
  state: PlanEngineState,
): { state: PlanEngineState; update: RunUpdate | null } {
  const efforts = collectRunEfforts(input.logs, input.sets, input.distanceUnit);
  const zones = buildRunPaceZones(efforts);
  if (state.runVdot == null) {
    // Nothing in the plan was written against a fitness yet: remember today's.
    return { state: { ...state, runVdot: zones?.vdot ?? null }, update: null };
  }
  if (!zones || input.fatigued || zones.vdot < state.runVdot + MIN_VDOT_GAIN) {
    return { state, update: null };
  }
  const fromNewLog = input.logs.some(
    (log) => newLogIds.has(log.id) && log.date === zones.basis.date,
  );
  if (!fromNewLog) return { state, update: null };
  const to =
    Math.round(Math.min(zones.vdot, state.runVdot * (1 + MAX_VDOT_GAIN_FRACTION)) * 10) / 10;
  const km = Math.round(zones.basis.meters / 100) / 10;
  const minutes = Math.floor(zones.basis.seconds / 60);
  const seconds = String(Math.round(zones.basis.seconds % 60)).padStart(2, "0");
  const thresholdFrom = paceClock(paceAtFraction(state.runVdot, 0.88), input.distanceUnit);
  const thresholdTo = paceClock(paceAtFraction(to, 0.88), input.distanceUnit);
  return {
    state: { ...state, runVdot: to },
    update: {
      from: state.runVdot,
      to,
      reason: `your ${km} km in ${minutes}:${seconds} on ${weekdayName(zones.basis.date)} is a new best, so run paces move up (threshold ${thresholdFrom} → ${thresholdTo})`,
    },
  };
}

function applyRunUpdate(days: readonly WorkingDay[], update: RunUpdate): void {
  for (const day of days) {
    let changed = false;
    const rescale = (text: string): string => {
      const result = rescalePaces(text, update.from, update.to);
      changed ||= result.changed;
      return result.text;
    };
    day.mainWorkout = rescale(day.mainWorkout);
    if (day.accessory) day.accessory = rescale(day.accessory);
    if (day.notes) day.notes = rescale(day.notes);
    for (const set of day.day.sets) {
      if (!set.notes) continue;
      const next = rescale(set.notes);
      if (next !== set.notes) day.setNotes.set(set.id, next);
    }
    if (!changed) continue;
    day.changes.push({
      exercise: "run_paces",
      kind: "pace",
      from: update.from,
      to: update.to,
      unit: "vdot",
    });
    day.reasons.push(update.reason);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function initialState(input: AdaptationInput): PlanEngineState {
  return (
    input.plan.engineState ?? { version: 1, runVdot: null, adaptedLogIds: [], updatedAt: input.now }
  );
}

/** Training logs not yet adapted, recent enough to matter, oldest first. */
function logsToAdapt(input: AdaptationInput, state: PlanEngineState): AdaptationLog[] {
  const seen = new Set(state.adaptedLogIds);
  const earliest = [
    input.plan.startDate ?? "",
    addDaysToISODate(input.today, -ADAPTATION_WINDOW_DAYS),
  ]
    .sort()
    .at(-1)!;
  return input.logs
    .filter(
      (log) =>
        log.countsAsTraining !== false &&
        !seen.has(log.id) &&
        log.date >= earliest &&
        log.date <= input.today,
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

/** Each weighted exercise the log trained, with the session before it. */
function sessionsOf(
  log: AdaptationLog,
  sets: readonly AdaptationSet[],
): { session: LoggedSession; previous: AdaptationSet[] | null }[] {
  const byExercise = new Map<string, AdaptationSet[]>();
  for (const set of sets) {
    if (set.workoutLogId !== log.id || !isAdaptableSet(set)) continue;
    if (implementFor(set.exerciseName) === "bodyweight") continue;
    const list = byExercise.get(set.exerciseName) ?? [];
    list.push(set);
    byExercise.set(set.exerciseName, list);
  }
  return [...byExercise].map(([exercise, logged]) => {
    const earlier = sets.filter(
      (set) =>
        set.exerciseName === exercise &&
        set.workoutLogId !== log.id &&
        set.date < log.date &&
        isAdaptableSet(set),
    );
    const lastDate = earlier
      .map((set) => set.date)
      .sort()
      .at(-1);
    const lastLog = earlier.find((set) => set.date === lastDate)?.workoutLogId;
    const previous = lastLog ? earlier.filter((set) => set.workoutLogId === lastLog) : null;
    const ordered = [...logged].sort((a, b) => (a.setNumber ?? 0) - (b.setNumber ?? 0));
    return { session: { log, exercise, sets: ordered }, previous };
  });
}

function buildInputs(day: WorkingDay, input: AdaptationInput, reason: string): CoachNoteInputs {
  const prior = day.day.aiInputsUsed;
  return {
    ...(day.phase ? { planPhase: day.phase } : {}),
    ...(prior?.replacedPrescription ? { replacedPrescription: prior.replacedPrescription } : {}),
    ...(prior?.lastFatigueReduction ? { lastFatigueReduction: prior.lastFatigueReduction } : {}),
    lastModification: { kind: "auto_progression", reason: reason.slice(0, 400), at: input.now },
    progressionChanges: day.changes.slice(0, 10).map((change) => ({ ...change })),
  };
}

function toDayAdaptation(day: WorkingDay, input: AdaptationInput): DayAdaptation | null {
  if (day.changes.length === 0) return null;
  const setUpdates: SetLoadUpdate[] = [];
  for (const set of day.day.sets) {
    const weight = day.touchedSets.has(set.id) ? day.weights.get(set.id) : undefined;
    const notes = day.setNotes.get(set.id);
    if (weight == null && notes == null) continue;
    setUpdates.push({
      setId: set.id,
      ...(weight == null ? {} : { weight, weightUnit: input.weightUnit }),
      ...(notes == null ? {} : { notes }),
    });
  }
  const sentences = [...new Set(day.reasons)].map(
    (reason) => `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`,
  );
  const rationale = `Auto-progression: ${sentences.join(" ")}`.slice(0, RATIONALE_MAX);
  return {
    planDayId: day.day.id,
    setUpdates,
    ...(day.mainWorkout === day.day.mainWorkout ? {} : { mainWorkout: day.mainWorkout }),
    ...(day.accessory === (day.day.accessory ?? null) ? {} : { accessory: day.accessory }),
    ...(day.notes === (day.day.notes ?? null) ? {} : { notes: day.notes }),
    rationale,
    inputsUsed: buildInputs(day, input, rationale),
    changes: day.changes,
  };
}

export function adaptPlan(input: AdaptationInput): AdaptationResult {
  let state = initialState(input);
  const newLogs = logsToAdapt(input, state);
  const excluded = input.excludedDayIds ?? new Set<string>();
  const working = input.upcoming
    .filter((day) => !excluded.has(day.id) && day.date >= input.today)
    .map((day) => toWorkingDay(day, input));
  const horizonEnd = addDaysToISODate(input.today, LOAD_HORIZON_DAYS);
  const ctx: ApplyContext = { unit: input.weightUnit, fatigued: input.fatigued };

  for (const log of newLogs) {
    for (const { session, previous } of sessionsOf(log, input.sets)) {
      const targets = working.filter(
        (day) =>
          day.day.date > log.date &&
          day.day.date <= horizonEnd &&
          setsOf(day, session.exercise).length > 0,
      );
      if (targets.length === 0) continue;
      applyDecision(session, decide(session, previous, input.weightUnit), targets, ctx);
    }
  }

  applyReturnFromBreak(working, input, horizonEnd);

  const newLogIds = new Set(newLogs.map((log) => log.id));
  const run = decideRunUpdate(input, newLogIds, state);
  state = run.state;
  if (run.update) applyRunUpdate(working, run.update);

  const adaptedLogIds = newLogs.map((log) => log.id);
  const nextState: PlanEngineState = {
    ...state,
    adaptedLogIds: [...state.adaptedLogIds, ...adaptedLogIds].slice(-MAX_ADAPTED_LOG_IDS),
    updatedAt: input.now,
  };
  return {
    days: working.flatMap((day) => toDayAdaptation(day, input) ?? []),
    engineState: nextState,
    adaptedLogIds,
  };
}
