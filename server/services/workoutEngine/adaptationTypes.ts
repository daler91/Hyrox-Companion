/**
 * What the plan adaptation reads and returns (./adaptation.ts decides; the
 * caller, planAdaptationService, loads the inputs and persists the result).
 * Types only, so every part of the adaptation can share them.
 */
import type { CoachNoteInputs, PlanEngineState } from "@shared/schema";
import type { WeightUnit } from "@shared/unitConversion";

import type { EngineRunLog } from "./running";

export interface AdaptationLog extends EngineRunLog {
  readonly id: string;
  /** Session RPE the athlete logged, 1-10. */
  readonly rpe?: number | null;
}

export interface AdaptationSet {
  readonly workoutLogId: string;
  readonly date: string;
  readonly exerciseName: string;
  /** Which custom lift a "custom" set is. D14 (CODEBASE_ANALYSIS_2026-10-03) */
  readonly customLabel?: string | null;
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
  readonly customLabel?: string | null;
  readonly category?: string | null;
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

/**
 * How a session that never happened reads on the timeline: missed, skipped by
 * choice, or inside an absence the athlete declared (which the app never calls
 * a miss).
 */
export type MissedSessionKind = "missed" | "skipped" | "excused";

/** A key or supporting session of the plan that is not going to happen on its day. */
export interface MissedPlanSession {
  readonly planDayId: string;
  /** The day it is scheduled on: past, or still ahead for a session skipped in advance. */
  readonly date: string;
  readonly weekNumber: number;
  readonly kind: MissedSessionKind;
  /** Its prescribed sets, as they stood when it was missed. */
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
  /**
   * The plan's sessions that are not happening on their day: the recent ones,
   * and any the engine state still keeps a hold for. Left out, the pass does
   * not look at missed sessions at all and the state's record of them stands.
   */
  readonly missed?: readonly MissedPlanSession[];
  /**
   * Plan days the engine state keeps a hold for that are sessions again:
   * moved to a day still ahead, or logged after all. Their holds are taken back.
   */
  readonly returnedPlanDayIds?: ReadonlySet<string>;
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
