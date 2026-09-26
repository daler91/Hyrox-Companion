/**
 * The workout engine's whole answer for one plan, computed once before any
 * model call: every primary lift's week-by-week targets, the athlete's run
 * paces and weekly volume, the weekly rhythm of sessions, and — when stations
 * matter — the station doses for each phase.
 *
 * Generation hands each chunk the slice of this it covers (see
 * server/prompts/workoutEngine.ts) and repairs the model's primary-lift sets
 * back to it afterwards (planRepair.ts). Pure: all history arrives as data.
 */
import type { TrainingPhase } from "@shared/nutritionTargets";
import { stationsRuledOutByConstraints } from "@shared/stationCoverage";
import type { DistanceUnit, WeightUnit } from "@shared/unitConversion";

import type { ExperienceLevel, GoalLens } from "../ai/exerciseKnowledge";
import { STATION_KEYS } from "../ai/exerciseProfile";
import type { PrimaryLift } from "../ai/exerciseSelection";
import { buildPlanOutline, type PlanWeekOutline } from "../planBlueprint";
import { type EngineSet, estimateStrength } from "./loadMath";
import {
  buildRunPaceZones,
  buildRunVolumeBaseline,
  buildRunVolumeTargets,
  collectRunEfforts,
  type EngineRunLog,
  type RunPaceZones,
  type RunVolumeBaseline,
  type RunWeekTarget,
} from "./running";
import { buildStationPhasePlan, type StationPhasePlan } from "./stations";
import { buildLiftPrograms, type LiftProgram } from "./strength";
import { buildWeekSkeleton, type WeekSkeleton } from "./weekSkeleton";

export interface WorkoutEngineInput {
  readonly lens: GoalLens;
  readonly experience: ExperienceLevel;
  readonly primaryLifts: readonly PrimaryLift[];
  readonly goal?: string | null;
  readonly focusAreas?: readonly string[] | null;
  readonly constraints?: string | null;
  readonly totalWeeks: number;
  readonly daysPerWeek: number;
  readonly restDays?: readonly string[] | null;
  readonly hasRace: boolean;
  readonly today: string;
  readonly weightUnit: WeightUnit;
  readonly distanceUnit: DistanceUnit;
  readonly division?: string | null;
  readonly gender?: string | null;
  /** The athlete's logged sets from the last ~10 weeks. */
  readonly sets: readonly EngineSet[];
  /** Their workout logs from the same window, for runs. */
  readonly logs: readonly EngineRunLog[];
}

export interface WorkoutEnginePlan {
  readonly lens: GoalLens;
  readonly weightUnit: WeightUnit;
  readonly distanceUnit: DistanceUnit;
  readonly totalWeeks: number;
  readonly hasRace: boolean;
  readonly outline: readonly PlanWeekOutline[];
  readonly lifts: readonly LiftProgram[];
  readonly paces: RunPaceZones | null;
  readonly runBaseline: RunVolumeBaseline | null;
  /** One entry per week, or empty for a goal with no running backbone. */
  readonly runVolume: readonly RunWeekTarget[];
  /** The week's sessions, per week (index = week - 1). */
  readonly weeks: readonly WeekSkeleton[];
  /** Station doses per phase, when the goal trains stations. */
  readonly stations: ReadonlyMap<TrainingPhase, StationPhasePlan>;
}

function stationsMatter(input: WorkoutEngineInput): boolean {
  return input.lens === "hyrox" || (input.focusAreas ?? []).some((area) => STATION_KEYS.has(area));
}

function buildStationPlans(
  input: WorkoutEngineInput,
  outline: readonly PlanWeekOutline[],
): Map<TrainingPhase, StationPhasePlan> {
  const plans = new Map<TrainingPhase, StationPhasePlan>();
  if (!stationsMatter(input)) return plans;
  const excluded = new Set<string>(stationsRuledOutByConstraints(input.constraints ?? null));
  for (const { phase } of outline) {
    if (plans.has(phase)) continue;
    plans.set(
      phase,
      buildStationPhasePlan(phase, {
        division: input.division,
        gender: input.gender,
        unit: input.weightUnit,
        excluded,
      }),
    );
  }
  return plans;
}

function buildWeeks(
  input: WorkoutEngineInput,
  outline: readonly PlanWeekOutline[],
): WeekSkeleton[] {
  // The rhythm depends on the phase only through a HYROX peak's simulation
  // day, so it is computed once per phase and shared by that phase's weeks.
  const byPhase = new Map<TrainingPhase, WeekSkeleton>();
  return outline.map(({ phase }) => {
    let skeleton = byPhase.get(phase);
    if (!skeleton) {
      skeleton = buildWeekSkeleton({
        lens: input.lens,
        phase,
        daysPerWeek: input.daysPerWeek,
        restDays: input.restDays,
        primaryLifts: input.primaryLifts,
      });
      byPhase.set(phase, skeleton);
    }
    return skeleton;
  });
}

export function buildWorkoutEnginePlan(input: WorkoutEngineInput): WorkoutEnginePlan {
  const outline = buildPlanOutline(input.totalWeeks);
  const efforts = collectRunEfforts(input.logs, input.sets, input.distanceUnit);
  const runBaseline = buildRunVolumeBaseline(efforts, input.today);
  return {
    lens: input.lens,
    weightUnit: input.weightUnit,
    distanceUnit: input.distanceUnit,
    totalWeeks: input.totalWeeks,
    hasRace: input.hasRace,
    outline,
    lifts: buildLiftPrograms({
      lens: input.lens,
      experience: input.experience,
      unit: input.weightUnit,
      outline,
      primaryLifts: input.primaryLifts,
      estimates: estimateStrength(input.sets, input.weightUnit),
    }),
    paces: buildRunPaceZones(efforts),
    runBaseline,
    runVolume: buildRunVolumeTargets({
      lens: input.lens,
      experience: input.experience,
      goal: input.goal,
      outline,
      baseline: runBaseline,
      hasRace: input.hasRace,
    }),
    weeks: buildWeeks(input, outline),
    stations: buildStationPlans(input, outline),
  };
}
