/**
 * What each non-lifting session of the week actually contains: the main set of
 * a threshold run at the athlete's own threshold pace, the long run at its
 * distance for that week, the easy runs that make up the rest of the week's
 * volume, and what a station or simulation day is built from.
 *
 * Paces come from the athlete's fitted zones when there are any; without them
 * every session is prescribed by effort instead, never by a made-up pace.
 */
import type { TrainingPhase } from "@shared/nutritionTargets";
import type { DistanceUnit } from "@shared/unitConversion";

import type { GoalLens } from "../ai/exerciseKnowledge";
import type { RunPaceZones, RunWeekTarget } from "./running";
import type { SessionKind, SkeletonSession } from "./weekSkeleton";

const KM_PER_MILE = 1.609344;
/** Warm-up plus cool-down around a quality session, in km. */
const QUALITY_EXTRA_KM = 3;
/** The pace a timed rep is costed at when the athlete has no paces: 5:30/km. */
const DEFAULT_WORK_SEC_PER_KM = 330;
const MIN_EASY_RUN_KM = 3;

export interface SessionContext {
  readonly lens: GoalLens;
  readonly phase: TrainingPhase;
  readonly deload: boolean;
  readonly paces: RunPaceZones | null;
  readonly volume: RunWeekTarget | null;
  readonly distanceUnit: DistanceUnit;
  /** Every session of the week, so easy runs can split what the others leave. */
  readonly weekSessions: readonly SkeletonSession[];
  /** The peak's race rehearsal: a full simulation rather than the half one. */
  readonly fullSimulation?: boolean;
}

function paceClock(secondsPerKm: number, unit: DistanceUnit): string {
  const perUnit = unit === "miles" ? secondsPerKm * KM_PER_MILE : secondsPerKm;
  const total = Math.round(perUnit);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function paceSuffix(unit: DistanceUnit): string {
  return unit === "miles" ? "/mi" : "/km";
}

function paceText(secondsPerKm: number, unit: DistanceUnit): string {
  return `${paceClock(secondsPerKm, unit)}${paceSuffix(unit)}`;
}

/** "6:05-6:42/km": the fast end first, as a runner reads a range. */
function paceRange(fast: number, slow: number, unit: DistanceUnit): string {
  return `${paceClock(fast, unit)}-${paceClock(slow, unit)}${paceSuffix(unit)}`;
}

export function distanceText(km: number, unit: DistanceUnit): string {
  const value = unit === "miles" ? km / KM_PER_MILE : km;
  return `${Math.round(value * 2) / 2} ${unit === "miles" ? "mi" : "km"}`;
}

/** The pace line for the prompt: every zone, in the athlete's unit. */
export function describePaceZones(zones: RunPaceZones, unit: DistanceUnit): string {
  return [
    `easy ${paceRange(zones.easy.fast, zones.easy.slow, unit)}`,
    `steady ${paceText(zones.steady, unit)}`,
    `threshold ${paceText(zones.threshold, unit)}`,
    `intervals ${paceText(zones.interval, unit)}`,
    `reps ${paceText(zones.repetition, unit)}`,
  ].join(" · ");
}

type QualityZone = "steady" | "threshold" | "interval";

function zonePace(paces: RunPaceZones, zone: QualityZone): number {
  if (zone === "steady") return paces.steady;
  return zone === "threshold" ? paces.threshold : paces.interval;
}

function zoneOrEffort(ctx: SessionContext, zone: QualityZone, effort: string): string {
  return ctx.paces ? `@ ${paceText(zonePace(ctx.paces, zone), ctx.distanceUnit)}` : `@ ${effort}`;
}

function easyText(ctx: SessionContext): string {
  if (!ctx.paces) return "easy (conversational, RPE 3-4)";
  return `easy @ ${paceRange(ctx.paces.easy.fast, ctx.paces.easy.slow, ctx.distanceUnit)}`;
}

interface QualityShape {
  readonly reps: number;
  /** Minutes of work per rep, or metres when `meters` is set. */
  readonly amount: number;
  readonly meters?: boolean;
  readonly recovery: string;
}

const THRESHOLD_SHAPES: Readonly<Record<TrainingPhase, QualityShape>> = {
  early: { reps: 3, amount: 8, recovery: "2 min jog" },
  build: { reps: 3, amount: 10, recovery: "2 min jog" },
  peak: { reps: 2, amount: 15, recovery: "3 min jog" },
  taper: { reps: 2, amount: 8, recovery: "2 min jog" },
  race_week: { reps: 2, amount: 5, recovery: "2 min jog" },
};

const INTERVAL_SHAPES: Readonly<Record<TrainingPhase, QualityShape>> = {
  early: { reps: 8, amount: 400, meters: true, recovery: "90 s jog" },
  build: { reps: 5, amount: 1000, meters: true, recovery: "2-3 min jog" },
  peak: { reps: 6, amount: 1000, meters: true, recovery: "2 min jog" },
  taper: { reps: 4, amount: 800, meters: true, recovery: "2 min jog" },
  race_week: { reps: 4, amount: 400, meters: true, recovery: "90 s jog" },
};

/** HYROX intervals rehearse the race: 1 km repeats at race-run rhythm. */
const HYROX_INTERVAL_SHAPES: Readonly<Record<TrainingPhase, QualityShape>> = {
  early: { reps: 6, amount: 800, meters: true, recovery: "90 s walk" },
  build: { reps: 6, amount: 1000, meters: true, recovery: "75 s walk" },
  peak: { reps: 8, amount: 1000, meters: true, recovery: "60 s walk" },
  taper: { reps: 4, amount: 1000, meters: true, recovery: "90 s walk" },
  race_week: { reps: 3, amount: 1000, meters: true, recovery: "2 min walk" },
};

/** The phase's quality-run shape; a deload keeps the shape at about half its reps. */
function qualityShape(
  shapes: Readonly<Record<TrainingPhase, QualityShape>>,
  ctx: SessionContext,
): QualityShape {
  const shape = shapes[ctx.phase];
  return ctx.deload ? { ...shape, reps: Math.max(1, Math.ceil(shape.reps / 2)) } : shape;
}

function workKm(shape: QualityShape, secondsPerKm = DEFAULT_WORK_SEC_PER_KM): number {
  if (shape.meters) return (shape.reps * shape.amount) / 1000;
  return (shape.reps * shape.amount * 60) / secondsPerKm;
}

function thresholdSession(ctx: SessionContext): { text: string; km: number } {
  const shape = qualityShape(THRESHOLD_SHAPES, ctx);
  const target = zoneOrEffort(ctx, "threshold", "threshold effort (RPE 7-8, comfortably hard)");
  const km = workKm(shape, ctx.paces?.threshold) + QUALITY_EXTRA_KM;
  return {
    text: `15 min easy, ${shape.reps} x ${shape.amount} min ${target} with ${shape.recovery}, 10 min easy (~${distanceText(km, ctx.distanceUnit)})`,
    km,
  };
}

function intervalSession(ctx: SessionContext): { text: string; km: number } {
  const hyrox = ctx.lens === "hyrox";
  const shape = qualityShape(hyrox ? HYROX_INTERVAL_SHAPES : INTERVAL_SHAPES, ctx);
  const target = hyrox
    ? zoneOrEffort(ctx, "steady", "race-run effort (RPE 7-8)")
    : zoneOrEffort(ctx, "interval", "5K effort (RPE 8-9)");
  const km = workKm(shape) + QUALITY_EXTRA_KM;
  return {
    text: `15 min easy, ${shape.reps} x ${shape.amount} m ${target} with ${shape.recovery}, 10 min easy (~${distanceText(km, ctx.distanceUnit)})`,
    km,
  };
}

function longRunText(ctx: SessionContext): string {
  const km = ctx.volume?.longRunKm ?? 0;
  const distance = km > 0 ? `${distanceText(km, ctx.distanceUnit)} ` : "";
  const finish =
    ctx.phase === "peak" && ctx.lens === "running" && !ctx.deload
      ? `, last 15 min ${zoneOrEffort(ctx, "steady", "steady effort (RPE 6)")}`
      : "";
  return `${distance}${easyText(ctx)}${finish}`;
}

const STATION_DAY: Readonly<Record<TrainingPhase, string>> = {
  early: "3-4 stations from the station doses, each straight after an 800 m run",
  build: "4-5 stations from the station doses, a 1 km run before each",
  peak: "stations at full race distance and race load, each straight off a 1 km run",
  taper: "short station doses with 500 m runs between, stop fresh",
  race_week: "2-3 station openers with 400 m runs between",
};

const SIMULATION: Readonly<Record<TrainingPhase, string>> = {
  early: "4 x (1 km run + 1 station at race load), race order",
  build: "4 x (1 km run + 1 station at race load), race order",
  peak: "half simulation: 4 x (1 km run + 1 station at race load), race order",
  taper: "mini simulation: 4 x (500 m run + half a station at race load)",
  race_week: "no simulation — race week",
};
const FULL_SIMULATION =
  "FULL race simulation: 8 x (1 km run + 1 station at race load) in race order, race pacing and transitions";
/** Deloads keep the session's shape at about half its work. */
const DELOAD_NOTE = " — deload: about half the usual work";

const CONDITIONING: Readonly<Record<GoalLens, string>> = {
  strength:
    "15-20 min low-impact intervals (bike, rower or sled), RPE 7-8 — short, so it never blunts the lifting",
  hybrid: "20-30 min mixed intervals (bike, row, ski, carries), RPE 7-8",
  hyrox: "20-30 min mixed intervals (ski, row, wall balls, carries), RPE 7-8",
  running: "20 min low-impact intervals (bike or rower), RPE 7",
  weight_loss: "25-35 min circuit or intervals (bike, row, kettlebell, bodyweight), RPE 7-8",
  general: "20-30 min circuit or intervals (bike, row, kettlebell, bodyweight), RPE 7",
};

/** The quality-session kilometres the easy runs have to leave room for. */
function qualityKm(ctx: SessionContext): number {
  let km = 0;
  for (const session of ctx.weekSessions) {
    if (session.kind === "threshold_run") km += thresholdSession(ctx).km;
    else if (session.kind === "interval_run") km += intervalSession(ctx).km;
    else if (session.kind === "long_run") km += ctx.volume?.longRunKm ?? 0;
  }
  return km;
}

function easyRunText(ctx: SessionContext): string {
  const easyRuns = ctx.weekSessions.filter((session) => session.kind === "easy_run").length;
  if (!ctx.volume || easyRuns === 0) return `30-40 min ${easyText(ctx)}`;
  const km = Math.max(MIN_EASY_RUN_KM, (ctx.volume.weeklyKm - qualityKm(ctx)) / easyRuns);
  return `${distanceText(km, ctx.distanceUnit)} ${easyText(ctx)}`;
}

function withDeload(text: string, ctx: SessionContext): string {
  return ctx.deload ? `${text}${DELOAD_NOTE}` : text;
}

function runPaceSuffix(ctx: SessionContext): string {
  return ctx.paces ? `, runs ${zoneOrEffort(ctx, "steady", "")}` : "";
}

/** One line describing the session's content, or null for strength (the lift targets say it). */
export function describeSession(kind: SessionKind, ctx: SessionContext): string | null {
  switch (kind) {
    case "strength":
      return null;
    case "threshold_run":
      return thresholdSession(ctx).text;
    case "interval_run":
      return intervalSession(ctx).text;
    case "long_run":
      return longRunText(ctx);
    case "easy_run":
      return easyRunText(ctx);
    case "stations":
      return withDeload(`${STATION_DAY[ctx.phase]}${runPaceSuffix(ctx)}`, ctx);
    case "simulation": {
      const shape = ctx.fullSimulation && !ctx.deload ? FULL_SIMULATION : SIMULATION[ctx.phase];
      return withDeload(`${shape}${runPaceSuffix(ctx)}`, ctx);
    }
    case "conditioning":
      return withDeload(CONDITIONING[ctx.lens], ctx);
    case "easy_cardio":
      return "30-45 min easy aerobic (bike, row, incline walk or easy run), conversational";
  }
}
