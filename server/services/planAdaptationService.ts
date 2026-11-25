/**
 * The auto-coach's adaptation stage: move the active plan's upcoming loads and
 * paces to follow what the athlete actually did, and what they did not do — a
 * logged session, and a session that was missed or skipped
 * (server/services/workoutEngine/adaptation.ts decides; this reads the inputs
 * and writes the result).
 *
 * Deterministic and free: it runs before the model is asked anything, still
 * runs when the athlete's AI budget is spent, and the days it changes are
 * kept out of the model's suggestions so a generic rewrite cannot undo a
 * number that came from the athlete's own training log.
 */
import { type AbsenceRange, isDateExcused, isExcusedFromMissed } from "@shared/absence";
import { addDaysToISODate } from "@shared/dateUtils";
import { inSequence } from "@shared/inSequence";
import type { TrainingPlan } from "@shared/schema";
import { resolveSessionPriority } from "@shared/sessionPriority";
import { standardizeWeightUnit, type UnitPreferences } from "@shared/unitConversion";

import type { DbExecutor } from "../db";
import type { TrainingContext } from "../gemini/index";
import { logger } from "../logger";
import { storage } from "../storage";
import { deriveRaceDayOverride } from "../storage/raceDayView";
import { getLocalDateStrSafe } from "../timezone";
import { fingerprintStoredPlanDay } from "./autoCoachWriteGuard";
import {
  type AdaptablePlanDay,
  type AdaptablePlanSet,
  type AdaptationResult,
  adaptPlan,
  LOAD_HORIZON_DAYS,
  MISSED_SESSION_WINDOW_DAYS,
  type MissedPlanSession,
} from "./workoutEngine/adaptation";

/** History the adaptation reads: the same ~10-week window generation calibrates from. */
const HISTORY_DAYS = 70;

export interface PlanAdaptation {
  readonly planId: string;
  readonly result: AdaptationResult;
  /**
   * What the adaptation was computed from: the engine state's stamp and each
   * changed day's prescription fingerprint, so the coach's write can tell the
   * plan moved underneath it (autoCoachWriteGuard). AI16 (CODEBASE_ANALYSIS_2026-10-03)
   */
  readonly baseline: {
    readonly engineStateUpdatedAt: string | null;
    readonly dayFingerprints: ReadonlyMap<string, string | undefined>;
  };
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

function toAdaptableSets(row: AdaptationPlanDayRow): AdaptablePlanSet[] {
  return row.sets.map((set) => ({
    id: set.id,
    exerciseName: set.exerciseName,
    // A custom lift is keyed by its label (liftKey), so without it no logged
    // custom lift finds its planned sets. D14 (CODEBASE_ANALYSIS_2026-10-03)
    customLabel: set.customLabel,
    category: set.category,
    reps: set.reps,
    weight: set.weight,
    weightUnit: set.weightUnit,
    notes: set.notes,
  }));
}

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
    sets: toAdaptableSets(row),
  };
}

interface MissedSessions {
  readonly missed: MissedPlanSession[];
  /** Days the engine holds a change for that are sessions again. */
  readonly returnedPlanDayIds: Set<string>;
}

/**
 * How a plan day that is not happening on its day reads, or null when it is a
 * session still (ahead and planned, or done). The timeline's own reading
 * (server/storage/timeline.ts): skipped is the athlete's choice; missed is
 * stored, or a planned day whose date has gone; and a declared absence holds
 * either out of missed.
 */
function missedKind(
  row: AdaptationPlanDayRow,
  date: string,
  today: string,
  absences: readonly AbsenceRange[],
): MissedPlanSession["kind"] | null {
  if (row.status === "skipped") return "skipped";
  const gone = row.status === "missed" || (row.status === "planned" && date < today);
  if (!gone) return null;
  return isExcusedFromMissed(row.status, date, today, isDateExcused(date, absences))
    ? "excused"
    : "missed";
}

/**
 * The plan's sessions the engine should follow as not done, and the ones it
 * was following that are back. Only sessions the plan leans on: key and
 * supporting ones, as the coach's own list of misses (collectRecentMisses).
 * An optional session, a rest day, a day the race date sets (its stored
 * session is not what the athlete saw), and a day from a retired plan's
 * cut-off on are nobody's missed step.
 */
function readMissedSessions(
  rows: readonly AdaptationPlanDayRow[],
  plan: Pick<TrainingPlan, "raceDate" | "retiredOn" | "engineState">,
  today: string,
  absences: readonly AbsenceRange[],
): MissedSessions {
  const held = new Set((plan.engineState?.missHolds ?? []).map((hold) => hold.planDayId));
  const missed: MissedPlanSession[] = [];
  const returnedPlanDayIds = new Set<string>();
  for (const row of rows) {
    const date = row.scheduledDate;
    if (!date) continue;
    const kind = missedKind(row, date, today, absences);
    if (kind === null) {
      if (held.has(row.id)) returnedPlanDayIds.add(row.id);
      continue;
    }
    if (plan.retiredOn && date >= plan.retiredOn) continue;
    if (deriveRaceDayOverride(date, plan.raceDate) !== null) continue;
    const priority = resolveSessionPriority(row);
    if (priority !== "key" && priority !== "supporting") continue;
    missed.push({
      planDayId: row.id,
      date,
      weekNumber: row.weekNumber,
      kind,
      sets: toAdaptableSets(row),
    });
  }
  return { missed, returnedPlanDayIds };
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
    const [logs, sets, days, notHappening, annotations] = await Promise.all([
      storage.analytics.getWorkoutLogsByDateRange(userId, from, today),
      storage.analytics.getAllExerciseSetsWithDates(userId, from, today),
      storage.plans.getPlanDaysForAdaptation(plan.id, today),
      storage.plans.getPlanDaysForMissAdaptation(plan.id, {
        from: addDaysToISODate(today, -MISSED_SESSION_WINDOW_DAYS),
        today,
        // A session skipped in advance holds the ones after it too.
        until: addDaysToISODate(today, LOAD_HORIZON_DAYS),
        alsoIds: [...new Set((plan.engineState?.missHolds ?? []).map((hold) => hold.planDayId))],
      }),
      storage.timelineAnnotations.list(userId),
    ]);
    const { missed, returnedPlanDayIds } = readMissedSessions(
      notHappening,
      plan,
      today,
      annotations.map(({ startDate, endDate }) => ({ startDate, endDate })),
    );
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
      missed,
      returnedPlanDayIds,
    });
    const changed = new Set(result.days.map((day) => day.planDayId));
    const dayFingerprints = new Map(
      days
        .filter((day) => changed.has(day.id))
        .map((day) => [day.id, fingerprintStoredPlanDay(day, day.sets)] as const),
    );
    return {
      planId: plan.id,
      result,
      baseline: { engineStateUpdatedAt: plan.engineState?.updatedAt ?? null, dayFingerprints },
    };
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
  await inSequence(adaptation.result.days, async (day) => {
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
    if (!updated) return;
    await storage.plans.updatePlanDaySets(day.planDayId, day.setUpdates, tx);
    adapted += 1;
  });
  await storage.plans.updateEngineState(
    adaptation.planId,
    userId,
    adaptation.result.engineState,
    tx,
  );
  return adapted;
}
