/**
 * The athlete's current numbers, for the coach and the chat: estimated 1RMs on
 * the lifts they train (with the working loads those imply) and their run
 * paces — computed by the same functions that build and adapt their plan, so
 * "what should I squat on Thursday?" gets the number the plan would give.
 */
import type { WeightUnit } from "@shared/unitConversion";

import {
  type EngineSet,
  estimateStrength,
  loadForReps,
  roundLoad,
  type StrengthEstimate,
} from "./loadMath";
import {
  buildRunPaceZones,
  collectRunEfforts,
  type EngineRunLog,
  type RunPaceZones,
} from "./running";

export interface LiftTarget extends StrengthEstimate {
  /** Working loads at RPE 8 for the two rep counts most prescriptions sit near. */
  readonly fiveAtRpe8: number;
  readonly eightAtRpe8: number;
}

export interface TrainingTargets {
  readonly weightUnit: WeightUnit;
  readonly distanceUnit: string;
  readonly lifts: readonly LiftTarget[];
  readonly paces: RunPaceZones | null;
}

/** Enough lifts to cover a plan's backbone; more is prompt noise. */
const MAX_LIFTS = 6;

export function buildTrainingTargets(input: {
  readonly sets: readonly EngineSet[];
  readonly logs: readonly EngineRunLog[];
  readonly weightUnit: WeightUnit;
  readonly distanceUnit: string;
  /** Lifts to list first (the plan's primary lifts), in order. */
  readonly priority?: readonly string[];
}): TrainingTargets | null {
  const estimates = estimateStrength(input.sets, input.weightUnit);
  const priority = input.priority ?? [];
  const rank = (exercise: string) => {
    const index = priority.indexOf(exercise);
    return index < 0 ? priority.length : index;
  };
  const lifts = [...estimates.values()]
    .sort((a, b) => rank(a.exercise) - rank(b.exercise) || b.sessions - a.sessions)
    .slice(0, MAX_LIFTS)
    .map((estimate) => ({
      ...estimate,
      fiveAtRpe8: roundLoad(loadForReps(estimate.e1rm, 5, 8), estimate.exercise, input.weightUnit),
      eightAtRpe8: roundLoad(loadForReps(estimate.e1rm, 8, 8), estimate.exercise, input.weightUnit),
    }));
  const paces = buildRunPaceZones(collectRunEfforts(input.logs, input.sets, input.distanceUnit));
  if (lifts.length === 0 && !paces) return null;
  return { weightUnit: input.weightUnit, distanceUnit: input.distanceUnit, lifts, paces };
}
