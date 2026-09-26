/**
 * What "easy" and "threshold" mean for this athlete on this day: the heart-rate
 * bands and paces a run is graded against.
 *
 * Heart rate comes from the app's own zone model (trainingLoad/hrModel.ts,
 * Karvonen %HRR on measured or age-estimated max HR) so a grade never
 * disagrees with the zone the rest of the app shows. An athlete on the MAF
 * method is graded against their MAF ceiling instead of Z2 — it is the number
 * they are actually training to.
 *
 * Pace comes from the most specific source available: a pace written in the
 * plan day itself, then the plan's engine fitness (VDOT), then paces fitted to
 * the athlete's recent runs. Pure: the caller loads the inputs.
 */
import type { SessionGradeTargets } from "@shared/schema";
import type { SessionGradeIntent } from "@shared/sessionIntent";

import { hrZoneBoundaries } from "../trainingLoad/hrModel";
import type { AthleteLoadContext } from "../trainingLoad/types";
import { readWrittenPaces } from "../workoutEngine/paceRewrite";
import { EASY_FAST, EASY_SLOW, paceAtFraction, type RunPaceZones, THRESHOLD } from "../workoutEngine/running";
import { MAX_PLAUSIBLE_PACE_S_PER_KM, MIN_PLAUSIBLE_PACE_S_PER_KM } from "./constants";

export interface TargetInputs {
  readonly intent: SessionGradeIntent;
  readonly athlete: AthleteLoadContext;
  /** The athlete's MAF ceiling when they train by the MAF method, else null. */
  readonly mafCeilingHr: number | null;
  /** The plan day's prescription text. */
  readonly planText: string;
  /** `training_plans.engine_state.runVdot`, when the engine generated the plan. */
  readonly engineVdot: number | null;
  /** Paces fitted to the athlete's runs before this one (loaded only when needed). */
  readonly historyZones: RunPaceZones | null;
}

/** A written single pace doubles as both ends of an easy range, give or take this much. */
const SINGLE_EASY_PACE_SPREAD = 0.08;

function plausible(secondsPerKm: number): boolean {
  return secondsPerKm >= MIN_PLAUSIBLE_PACE_S_PER_KM && secondsPerKm <= MAX_PLAUSIBLE_PACE_S_PER_KM;
}

function midpoint(pace: readonly number[]): number {
  return pace.reduce((sum, value) => sum + value, 0) / Math.max(1, pace.length);
}

function writtenPaces(text: string): number[][] {
  return readWrittenPaces(text).filter((pace) => pace.length > 0 && pace.every(plausible));
}

/** The fastest pace the day prescribes — the work, not the warm-up. */
function writtenThresholdPace(text: string): number | null {
  const paces = writtenPaces(text).map(midpoint);
  return paces.length > 0 ? Math.min(...paces) : null;
}

/** The slowest range the day prescribes — the easy running, not a long run's finish or strides. */
function writtenEasyPace(text: string): { fast: number; slow: number } | null {
  const slowest = writtenPaces(text).reduce<number[] | null>(
    (best, pace) => (best === null || midpoint(pace) > midpoint(best) ? pace : best),
    null,
  );
  if (!slowest) return null;
  const fast = Math.min(...slowest);
  const slow = Math.max(...slowest);
  return fast === slow ? { fast, slow: fast * (1 + SINGLE_EASY_PACE_SPREAD) } : { fast, slow };
}

function paceTargets(inputs: TargetInputs): Pick<SessionGradeTargets, "easyPace" | "thresholdPace" | "paceSource"> {
  if (inputs.intent === "threshold") {
    const written = writtenThresholdPace(inputs.planText);
    if (written !== null) return { easyPace: null, thresholdPace: written, paceSource: "plan" };
    if (inputs.engineVdot) {
      return { easyPace: null, thresholdPace: paceAtFraction(inputs.engineVdot, THRESHOLD), paceSource: "engine" };
    }
    if (inputs.historyZones) {
      return { easyPace: null, thresholdPace: inputs.historyZones.threshold, paceSource: "history" };
    }
    return { easyPace: null, thresholdPace: null, paceSource: null };
  }
  const written = writtenEasyPace(inputs.planText);
  if (written) return { easyPace: written, thresholdPace: null, paceSource: "plan" };
  if (inputs.engineVdot) {
    return {
      easyPace: {
        fast: paceAtFraction(inputs.engineVdot, EASY_FAST),
        slow: paceAtFraction(inputs.engineVdot, EASY_SLOW),
      },
      thresholdPace: null,
      paceSource: "engine",
    };
  }
  if (inputs.historyZones) {
    return { easyPace: { ...inputs.historyZones.easy }, thresholdPace: null, paceSource: "history" };
  }
  return { easyPace: null, thresholdPace: null, paceSource: null };
}

export function resolveGradeTargets(inputs: TargetInputs): SessionGradeTargets {
  const zones = hrZoneBoundaries(inputs.athlete);
  const z2 = zones.at(1);
  const z4 = zones.at(3);
  const z5 = zones.at(4);
  const measured = (inputs.athlete.maxHr ?? 0) > 0;
  const maf = inputs.intent === "easy" && inputs.mafCeilingHr !== null && inputs.mafCeilingHr > 0;

  let hrBasis: SessionGradeTargets["hrBasis"] = null;
  if (maf) hrBasis = "maf";
  else if (zones.length > 0) hrBasis = measured ? "measured" : "age_estimated";

  return {
    easyCeilingHr: maf ? inputs.mafCeilingHr : (z2?.maxHr ?? null),
    thresholdHr: z4 ? { min: z4.minHr, max: z4.maxHr } : null,
    z5FloorHr: z5?.minHr ?? null,
    hrBasis,
    ...paceTargets(inputs),
  };
}

/** Whether the intent has anything at all to be graded against. */
export function hasTargets(intent: SessionGradeIntent, targets: SessionGradeTargets): boolean {
  if (intent === "easy") return targets.easyCeilingHr !== null || targets.easyPace !== null;
  return targets.thresholdHr !== null || targets.thresholdPace !== null;
}
