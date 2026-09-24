/**
 * The auto-coach's adaptation stage: after the athlete logs a session, move
 * the active plan's upcoming loads and paces to follow what they actually did
 * (server/services/workoutEngine/adaptation.ts decides; this reads the inputs
 * and writes the result).
 *
 * Deterministic and free: it runs before the model is asked anything, still
 * runs when the athlete's AI budget is spent, and the days it changes are
 * kept out of the model's suggestions so a generic rewrite cannot undo a
 * number that came from the athlete's own training log.
 */
import { addDaysToISODate } from "@shared/dateUtils";
import { standardizeWeightUnit, type UnitPreferences } from "@shared/unitConversion";

import type { DbExecutor } from "../db";
import type { TrainingContext } from "../gemini/index";
import { logger } from "../logger";
import { storage } from "../storage";
import { getLocalDateStrSafe } from "../timezone";
import {
  type AdaptablePlanDay,
  type AdaptationResult,
  adaptPlan,
} from "./workoutEngine/adaptation";

/** History the adaptation reads: the same ~10-week window generation calibrates from. */
const HISTORY_DAYS = 70;

export interface PlanAdaptation {
  readonly planId: string;
  readonly result: AdaptationResult;
}

/** Nothing may rise while the load governor or the RPE trend reports fatigue. */
export function isFatigued(trainingContext: TrainingContext): boolean {
  const insights = trainingContext.coachingInsights;
  const zone = insights?.loadGovernor?.zone;
  return zone === "danger" || zone === "yellow" || insights?.fatigueFlag === true;
}

type AdaptationPlanDayRow = Awaited<
  ReturnType<typeof storage.plans.getPlanDaysForAdaptation>
>[number];

function toAdaptableDay(row: AdaptationPlanDayRow): AdaptablePlanDay | null {
  if (!row.scheduledDate) return null;
  return {
    id: row.id,
    date: row.scheduledDate,
    weekNumber: row.weekNumber,
    mainWorkout: row.mainWorkout,
    accessory: row.accessory,
    notes: row.notes,
    aiInputsUsed: row.aiInputsUsed,
    sets: row.sets.map((set) => ({
      id: set.id,
      exerciseName: set.exerciseName,
      reps: set.reps,
      weight: set.weight,
      weightUnit: set.weightUnit,
      notes: set.notes,
    })),
  };
}

/**
 * What the athlete's recent logs change in their active plan, or null when
 * there is no plan to adapt. Never throws: a failure here costs the athlete an
 * adaptation, not the coach run it is part of.
 */
export async function computePlanAdaptation(
  userId: string,
  trainingContext: TrainingContext,
  unitPreferences: UnitPreferences,
  excludedDayIds: ReadonlySet<string>,
): Promise<PlanAdaptation | null> {
  try {
    const plan = await storage.plans.getActivePlan(userId);
    if (!plan) return null;
    const today = trainingContext.currentDate ?? getLocalDateStrSafe(new Date(), null);
    const from = addDaysToISODate(today, -HISTORY_DAYS);
    const [logs, sets, days] = await Promise.all([
      storage.analytics.getWorkoutLogsByDateRange(userId, from, today),
      storage.analytics.getAllExerciseSetsWithDates(userId, from, today),
      storage.plans.getPlanDaysForAdaptation(plan.id, today),
    ]);
    const result = adaptPlan({
      today,
      now: new Date().toISOString(),
      weightUnit: standardizeWeightUnit(unitPreferences.weightUnit),
      distanceUnit: unitPreferences.distanceUnit ?? "km",
      plan: {
        startDate: plan.startDate,
        totalWeeks: plan.totalWeeks,
        engineState: plan.engineState,
      },
      logs,
      sets,
      upcoming: days.flatMap((day) => toAdaptableDay(day) ?? []),
      fatigued: isFatigued(trainingContext),
      excludedDayIds,
    });
    return { planId: plan.id, result };
  } catch (err) {
    // Reads and a pure computation: a failed query or a bug reports its
    // message and stack, never the rows it read. userId stays out (logger S2).
    // bearer:disable javascript_lang_logger_leak
    logger.warn({ err }, "[coach] Plan adaptation unavailable; coaching without it.");
    return null;
  }
}

/** The plan days an adaptation will rewrite, so the model's pass leaves them alone. */
export function adaptedDayIds(adaptation: PlanAdaptation | null): Set<string> {
  return new Set(adaptation?.result.days.map((day) => day.planDayId) ?? []);
}

/**
 * Write an adaptation inside the coach's transaction: each changed day's text,
 * coach note and sets, then the plan's engine state (so each log counts once).
 * Returns how many days changed.
 */
export async function applyPlanAdaptation(
  adaptation: PlanAdaptation | null,
  userId: string,
  tx: DbExecutor,
): Promise<number> {
  if (!adaptation) return 0;
  let adapted = 0;
  for (const day of adaptation.result.days) {
    const updated = await storage.plans.updatePlanDay(
      day.planDayId,
      {
        ...(day.mainWorkout === undefined ? {} : { mainWorkout: day.mainWorkout }),
        ...(day.accessory === undefined ? {} : { accessory: day.accessory }),
        ...(day.notes === undefined ? {} : { notes: day.notes }),
        aiSource: "progression",
        aiRationale: day.rationale,
        aiNoteUpdatedAt: new Date(),
        aiInputsUsed: day.inputsUsed,
      },
      userId,
      tx,
    );
    if (!updated) continue;
    await storage.plans.updatePlanDaySets(day.planDayId, day.setUpdates, tx);
    adapted += 1;
  }
  await storage.plans.updateEngineState(
    adaptation.planId,
    userId,
    adaptation.result.engineState,
    tx,
  );
  return adapted;
}
