/**
 * The WORKOUT ENGINE TARGETS block of a plan-generation chunk: the weekly
 * rhythm, the athlete's evidence (estimated 1RMs, the run the paces were
 * fitted to), and — week by week for the weeks this chunk generates — every
 * session's content with the primary lifts' exact numbers.
 *
 * Every chunk renders its slice of the same engine plan, so two chunks that
 * never see each other still prescribe week 4's squat and week 5's squat on
 * one progression. The model's job narrows to what it is good at: turning
 * these targets into well-written sessions and choosing the accessories.
 */
import { formatPhaseName } from "@shared/planPhase";
import type { WeightUnit } from "@shared/unitConversion";

import { selectionExerciseLabel } from "../services/ai/exerciseSelection";
import type { WorkoutEnginePlan } from "../services/workoutEngine/enginePlan";
import { roundLoad } from "../services/workoutEngine/loadMath";
import {
  describePaceZones,
  describeSession,
  distanceText,
  type SessionContext,
} from "../services/workoutEngine/sessions";
import type { StationDose, StationPhasePlan } from "../services/workoutEngine/stations";
import {
  type LiftProgram,
  type LiftWeekTarget,
  LIGHT_EXPOSURE_FRACTION,
} from "../services/workoutEngine/strength";
import type { TrainingTargets } from "../services/workoutEngine/trainingTargets";
import type { SkeletonLift, SkeletonSession } from "../services/workoutEngine/weekSkeleton";

export interface EngineChunk {
  readonly startWeek: number;
  readonly endWeek: number;
  /** Week-1 days before the plan's start date: never scheduled, so never given a session. */
  readonly daysBeforeStart?: readonly string[];
}

function restText(rest: LiftWeekTarget["rest"]): string {
  return rest.maxSec <= 120
    ? `${rest.minSec}-${rest.maxSec} s`
    : `${rest.minSec / 60}-${rest.maxSec / 60} min`;
}

/** The week's load for this exposure: a light day works below the heavy day's load. */
function exposureLoad(lift: SkeletonLift, target: LiftWeekTarget, unit: WeightUnit): number | null {
  if (target.load == null) return null;
  if (lift.exposure !== "light") return target.load;
  return roundLoad(target.load * LIGHT_EXPOSURE_FRACTION, lift.exercise, unit, "down");
}

function liftTarget(lift: SkeletonLift, target: LiftWeekTarget, unit: WeightUnit): string {
  const perSide = lift.slot === "single_leg" ? " per side" : "";
  const load = exposureLoad(lift, target, unit);
  const loadText = load == null ? "" : ` @ ${load} ${unit}`;
  const effort =
    lift.exposure === "light"
      ? `light day, RPE ~${Math.max(6, target.rpe - 2)}`
      : `RPE ${target.rpe}`;
  return `${lift.exercise} ${target.sets}x${target.reps}${perSide}${loadText} (${effort}, rest ${restText(target.rest)})`;
}

function strengthLine(
  session: SkeletonSession,
  week: number,
  programs: ReadonlyMap<string, LiftProgram>,
  unit: WeightUnit,
): string {
  const lifts = session.lifts.flatMap((lift) => {
    const target = programs.get(lift.exercise)?.weeks.at(week - 1);
    return target ? [liftTarget(lift, target, unit)] : [];
  });
  const finisher = session.runFinisher ? "; then a 15-20 min easy run" : "";
  const body = lifts.length > 0 ? lifts.join(" · ") : "accessory strength for the brief's needs";
  return `${body}${finisher}`;
}

function sessionLine(
  session: SkeletonSession,
  week: number,
  engine: WorkoutEnginePlan,
  ctx: SessionContext,
  programs: ReadonlyMap<string, LiftProgram>,
): string {
  const content =
    session.kind === "strength"
      ? strengthLine(session, week, programs, engine.weightUnit)
      : describeSession(session.kind, ctx);
  return `- ${session.day}, ${session.label}: ${content ?? ""}`;
}

function weekHeader(engine: WorkoutEnginePlan, week: number): string {
  const entry = engine.outline.at(week - 1);
  if (!entry) return `Week ${week}:`;
  const isFinal = week === engine.totalWeeks;
  const phase =
    isFinal && !engine.hasRace ? "FINAL WEEK" : formatPhaseName(entry.phase).toUpperCase();
  return `Week ${week} — ${phase}${entry.deload ? ", DELOAD" : ""} (block ${entry.block}):`;
}

/**
 * The peak's last loading week carries the full race rehearsal; earlier peak
 * weeks run half a simulation, so the full one lands two to three weeks out.
 */
function isLastPeakWeek(engine: WorkoutEnginePlan, week: number): boolean {
  const entry = engine.outline.at(week - 1);
  if (entry?.phase !== "peak" || entry.deload) return false;
  return !engine.outline.some(
    (later) => later.week > week && later.phase === "peak" && !later.deload,
  );
}

/** Race week holds no programme of its own: primers early, then the race. */
function raceWeekLines(engine: WorkoutEnginePlan, week: number): string[] {
  const primers = engine.lifts.slice(0, 2).flatMap((program) => {
    const target = program.weeks.at(week - 1);
    if (!target) return [];
    const load = target.load == null ? "" : ` @ ${target.load} ${engine.weightUnit}`;
    return [`${program.exercise} ${target.sets}x${target.reps}${load}`];
  });
  const primer =
    primers.length > 0
      ? `a strength primer (${primers.join(", ")}, RPE 6)`
      : "a short strength primer";
  const openers = engine.stations.has("race_week")
    ? " and 2-3 station openers (RACE WEEK doses)"
    : "";
  return [
    weekHeader(engine, week),
    `- At most two short sessions early in the week: ${primer}, and a short run with 4 x 1 min at race-run effort${openers}. Rest or a 20 min shakeout the day before; race day is the event.`,
  ];
}

function weekLines(
  engine: WorkoutEnginePlan,
  week: number,
  chunk: EngineChunk,
  programs: ReadonlyMap<string, LiftProgram>,
): string[] {
  if (engine.hasRace && week === engine.totalWeeks) return raceWeekLines(engine, week);
  const skeleton = engine.weeks.at(week - 1);
  const entry = engine.outline.at(week - 1);
  if (!skeleton || !entry) return [];
  const volume = engine.runVolume.at(week - 1) ?? null;
  const ctx: SessionContext = {
    lens: engine.lens,
    phase: entry.phase,
    deload: entry.deload,
    paces: engine.paces,
    volume,
    distanceUnit: engine.distanceUnit,
    weekSessions: skeleton.sessions,
    fullSimulation: isLastPeakWeek(engine, week),
  };
  const skipped = new Set(week === 1 ? (chunk.daysBeforeStart ?? []) : []);
  const lines = [weekHeader(engine, week)];
  for (const session of skeleton.sessions) {
    if (skipped.has(session.day)) continue;
    lines.push(sessionLine(session, week, engine, ctx, programs));
  }
  return lines;
}

function rhythmLine(engine: WorkoutEnginePlan, week: number): string | null {
  const skeleton = engine.weeks.at(week - 1);
  if (!skeleton) return null;
  const days = skeleton.sessions.map((session) => `${session.day} = ${session.label}`);
  const rest = skeleton.restDays.length > 0 ? ` · rest: ${skeleton.restDays.join(", ")}` : "";
  return `- Weekly rhythm (the same days every week, deloads included): ${days.join(" · ")}${rest}. A declared absence or the plan start overrides a session day; the week's other sessions stay where they are.`;
}

function evidenceLine(engine: WorkoutEnginePlan): string | null {
  if (engine.lifts.length === 0) return null;
  const parts = engine.lifts.map((program) => {
    const estimate = program.estimate;
    if (!estimate) {
      return `${program.exercise}: no logged load, so its targets are effort only — pick the weight that leaves the reps in reserve its RPE implies`;
    }
    const { basis } = estimate;
    return `${program.exercise} est. 1RM ${estimate.e1rm} ${engine.weightUnit} (from ${basis.weight} ${engine.weightUnit} x ${basis.reps} on ${basis.date})`;
  });
  return `- Primary lifts, from the athlete's logs: ${parts.join(" · ")}. Loads below are computed from these; do not re-derive them.`;
}

function paceLine(engine: WorkoutEnginePlan): string | null {
  const paces = engine.paces;
  if (!paces) return null;
  const minutes = Math.floor(paces.basis.seconds / 60);
  const seconds = String(Math.round(paces.basis.seconds % 60)).padStart(2, "0");
  const basis = `${distanceText(paces.basis.meters / 1000, engine.distanceUnit)} in ${minutes}:${seconds} on ${paces.basis.date}`;
  return `- Run paces (fitted to the athlete's best recent run, ${basis}): ${describePaceZones(paces, engine.distanceUnit)}. Easy runs stay conversational even when a faster pace feels fine.`;
}

function doseText(dose: StationDose, unit: WeightUnit): string {
  const amount = dose.reps == null ? `${dose.distanceMeters} m` : String(dose.reps);
  let load = "";
  if (dose.load != null) load = ` @ ${dose.load} ${unit}`;
  else if (dose.loadFraction != null) load = ` @ ${Math.round(dose.loadFraction * 100)}% race load`;
  return `${selectionExerciseLabel(dose.station).toLowerCase()} ${dose.sets} x ${amount}${load}, rest ${dose.restSec} s (${dose.cue})`;
}

function stationLines(engine: WorkoutEnginePlan, chunk: EngineChunk): string[] {
  const phases = new Set(
    engine.outline
      .filter((entry) => entry.week >= chunk.startWeek && entry.week <= chunk.endWeek)
      .map((entry) => entry.phase),
  );
  const plans = [...phases]
    .map((phase) => engine.stations.get(phase))
    .filter((plan): plan is StationPhasePlan => plan != null && plan.doses.length > 0);
  return plans.map(
    (plan) =>
      `- Station doses, ${formatPhaseName(plan.phase).toUpperCase()} (${plan.intent}): ${plan.doses
        .map((dose) => doseText(dose, engine.weightUnit))
        .join(" · ")}.`,
  );
}

/** The engine block for one chunk; [] when there is no engine plan. */
export function describeEngineTargetLines(
  engine: WorkoutEnginePlan | null | undefined,
  chunk: EngineChunk,
): string[] {
  if (!engine) return [];
  const programs = new Map(engine.lifts.map((program) => [program.exercise, program]));
  const lines = [
    "",
    "WORKOUT ENGINE TARGETS (computed from the athlete's own logs and this plan's blueprint, identical in every chunk — write these sessions on these days with these numbers; your job is the session write-up, the warm-ups and the accessories around them):",
  ];
  for (const line of [
    rhythmLine(engine, chunk.startWeek),
    evidenceLine(engine),
    paceLine(engine),
  ]) {
    if (line) lines.push(line);
  }
  lines.push(...stationLines(engine, chunk));
  for (let week = chunk.startWeek; week <= chunk.endWeek; week++) {
    lines.push(...weekLines(engine, week, chunk, programs));
  }
  return lines;
}

/**
 * The TRAINING TARGETS block of a coach or chat prompt: the athlete's current
 * estimated 1RMs with the working loads they imply, and their run paces. Empty
 * when there is nothing to report.
 */
export function formatTrainingTargets(targets: TrainingTargets | null | undefined): string {
  if (!targets) return "";
  const lines = [
    "TRAINING TARGETS (computed from the athlete's logs by the same engine that builds and adapts their plan — prescribe loads and paces from these numbers):",
  ];
  const unit = targets.weightUnit;
  for (const lift of targets.lifts) {
    lines.push(
      `- ${selectionExerciseLabel(lift.exercise)}: est. 1RM ${lift.e1rm} ${unit} (from ${lift.basis.weight} ${unit} x ${lift.basis.reps} on ${lift.basis.date}) → 5 reps @ RPE 8 ≈ ${lift.fiveAtRpe8} ${unit} · 8 reps @ RPE 8 ≈ ${lift.eightAtRpe8} ${unit}`,
    );
  }
  if (targets.paces) {
    const unitName = targets.distanceUnit === "miles" ? "miles" : "km";
    lines.push(
      `- Run paces: ${describePaceZones(targets.paces, unitName)} (fitted to the best recent run, ${targets.paces.basis.date}).`,
    );
  }
  return lines.join("\n");
}
