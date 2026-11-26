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
import type { TrainingPlan, WorkoutSuggestion } from "@shared/schema";
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
  type AdaptationInput,
  type AdaptationResult,
  adaptPlan,
  describeMissHolds,
  LOAD_HORIZON_DAYS,
  MISSED_SESSION_WINDOW_DAYS,
  type MissedPlanSession,
  type MissFollowOn,
  missKey,
  previewMissHolds,
  standingMissHolds,
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
  /**
   * The upcoming days whose loads (or long run) an earlier pass holds for a
   * missed session and that still read what the hold wrote. This pass changes
   * nothing on them, so they are not among `result.days`; the model's pass
   * may add to them but not replace them (isReplaceOfHeldDay).
   */
  readonly heldDayIds: ReadonlySet<string>;
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
    // A long run's distance, which a missed long run holds (missedLongRun.ts).
    distance: set.distance,
    plannedDistance: set.plannedDistance,
    distanceUnit: set.distanceUnit,
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
  /** Days the engine holds a change for that are sessions again, and the day each is now on. */
  readonly returnedPlanDays: Map<string, string>;
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
 * Whether the adaptation follows a session that is not happening: one the plan
 * leans on, as the athlete was shown it, in the plan's live stretch.
 */
function isFollowedSession(
  row: AdaptationPlanDayRow,
  date: string,
  plan: Pick<TrainingPlan, "raceDate" | "retiredOn">,
): boolean {
  if (plan.retiredOn && date >= plan.retiredOn) return false;
  if (deriveRaceDayOverride(date, plan.raceDate) !== null) return false;
  const priority = resolveSessionPriority(row);
  return priority === "key" || priority === "supporting";
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
  const returnedPlanDays = new Map<string, string>();
  for (const row of rows) {
    const date = row.scheduledDate;
    if (!date) continue;
    const kind = missedKind(row, date, today, absences);
    if (kind === null) {
      // Moved, it is on its new day; logged after all, on the day it was missed.
      if (held.has(row.id)) returnedPlanDays.set(row.id, date);
      continue;
    }
    if (!isFollowedSession(row, date, plan)) continue;
    missed.push({
      planDayId: row.id,
      date,
      weekNumber: row.weekNumber,
      kind,
      sets: toAdaptableSets(row),
    });
  }
  return { missed, returnedPlanDays };
}

/**
 * The upcoming days a hold kept from an earlier pass still stands on: one of
 * their sets reads what the hold wrote. A hold written this pass is not
 * counted: its days are among the ones the pass changes, which the model is
 * kept off altogether (adaptedDayIds).
 */
function stillHeldDayIds(input: AdaptationInput, result: AdaptationResult): Set<string> {
  const standing = standingMissHolds(input, result.engineState.missHolds ?? []);
  const heldSets = new Set(standing.flatMap((hold) => hold.sets.map((record) => record.setId)));
  return new Set(
    input.upcoming
      .filter((day) => day.sets.some((set) => heldSets.has(set.id)))
      .map((day) => day.id),
  );
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
    const { missed, returnedPlanDays } = readMissedSessions(
      notHappening,
      plan,
      today,
      annotations.map(({ startDate, endDate }) => ({ startDate, endDate })),
    );
    const input: AdaptationInput = {
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
      returnedPlanDays,
    };
    const result = adaptPlan(input);
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
      heldDayIds: stillHeldDayIds(input, result),
    };
  } catch (err) {
    // Reads and a pure computation: a failed query or a bug reports its
    // message and stack, never the rows it read. userId stays out (logger S2).
    // bearer:disable javascript_lang_logger_leak
    logger.warn({ err }, "[coach] Plan adaptation unavailable; coaching without it.");
    return null;
  }
}

/** What a missed session changes in the sessions after it, for the recovery sheet. */
export interface MissedSessionFollowOn {
  /** A coach pass has already followed the miss: the changes are in the plan now. */
  readonly applied: boolean;
  /** Each lift it holds: the first session reached and the load left there. */
  readonly changes: readonly MissFollowOn[];
}

const NO_FOLLOW_ON: MissedSessionFollowOn = { applied: false, changes: [] };

/**
 * What following a missed session holds in the sessions after it — the plan
 * adaptation's own answer, so the sheet and the plan cannot disagree. Once a
 * coach pass has followed the miss, the holds it recorded that still stand;
 * before that, what the next pass would hold. Empty when nothing is held: no
 * weighted lift in the session, the plan already repeats the step, the lift
 * trained since, or a session the adaptation does not follow.
 *
 * Never throws: a failure here costs the sheet one line, not the sheet.
 */
export async function previewMissedSessionFollowOn(
  userId: string,
  planDayId: string,
  today: string,
  unitPreferences: UnitPreferences,
): Promise<MissedSessionFollowOn> {
  try {
    const plan = await storage.plans.getActivePlan(userId);
    if (!plan) return NO_FOLLOW_ON;
    const weightUnit = standardizeWeightUnit(unitPreferences.weightUnit);
    const [upcomingRows, rows, annotations] = await Promise.all([
      storage.plans.getPlanDaysForAdaptation(plan.id, today),
      storage.plans.getPlanDaysForMissAdaptation(plan.id, {
        from: addDaysToISODate(today, -MISSED_SESSION_WINDOW_DAYS),
        today,
        until: today,
        alsoIds: [planDayId],
      }),
      storage.timelineAnnotations.list(userId),
    ]);
    const row = rows.find((candidate) => candidate.id === planDayId);
    if (!row?.scheduledDate) return NO_FOLLOW_ON;
    const upcoming = upcomingRows.flatMap((day) => toAdaptableDay(day) ?? []);
    const distanceUnit = unitPreferences.distanceUnit ?? "km";
    /** The plan as the adaptation reads it, with whatever was logged since `since`. */
    const inputWith = (
      logged: Pick<Parameters<typeof previewMissHolds>[0], "logs" | "sets">,
    ): Parameters<typeof previewMissHolds>[0] => ({
      today,
      now: new Date().toISOString(),
      weightUnit,
      distanceUnit,
      plan: { startDate: plan.startDate, totalWeeks: plan.totalWeeks, engineState: plan.engineState },
      upcoming,
      fatigued: false,
      ...logged,
    });

    const key = missKey({ planDayId, date: row.scheduledDate });
    const recorded = (plan.engineState?.missHolds ?? []).filter(
      (hold) => missKey({ planDayId: hold.planDayId, date: hold.missedOn }) === key,
    );
    // Counted, or holding already while one of its steps waits for a session
    // to come into range (holdMissedSessions).
    if (plan.engineState?.adaptedMisses?.includes(key) || recorded.length > 0) {
      // Already followed: say what still stands of it, not what it once wrote.
      const standing = standingMissHolds(inputWith({ logs: [], sets: [] }), recorded);
      return { applied: true, changes: describeMissHolds(standing, upcoming, distanceUnit) };
    }

    const { missed } = readMissedSessions(
      [row],
      plan,
      today,
      annotations.map(({ startDate, endDate }) => ({ startDate, endDate })),
    );
    const miss = missed.at(0);
    if (!miss) return NO_FOLLOW_ON;
    // Only what was logged since the miss matters: a lift trained anyway, or a
    // long run run anyway, is not held.
    const [logs, sets] = await Promise.all([
      storage.analytics.getWorkoutLogsByDateRange(userId, miss.date, today),
      storage.analytics.getAllExerciseSetsWithDates(userId, miss.date, today),
    ]);
    const holds = previewMissHolds(inputWith({ logs, sets }), miss);
    return { applied: false, changes: describeMissHolds(holds, upcoming, distanceUnit) };
  } catch (err) {
    // Reads and a pure computation; no row content is logged (logger S2).
    // bearer:disable javascript_lang_logger_leak
    logger.warn({ err }, "[recovery] Could not work out what a missed session changes next.");
    return NO_FOLLOW_ON;
  }
}

/** The plan days an adaptation will rewrite, so the model's pass leaves them alone. */
export function adaptedDayIds(adaptation: PlanAdaptation | null): Set<string> {
  return new Set(adaptation?.result.days.map((day) => day.planDayId) ?? []);
}

/**
 * Whether a model suggestion would replace the prescription of a day whose
 * loads still stand held for a missed session. The hold was written on an
 * earlier pass, so nothing else keeps the model off the day, and a replace
 * swaps every set row: the loads go wherever the rewrite puts them, past the
 * step that was not done, and the rows the hold is recorded against are
 * gone, so it could never be taken back. The coach pass refuses these and
 * reviews the day instead. A note, or an exercise appended, leaves the held
 * sets as they are and goes through.
 */
export function isReplaceOfHeldDay(
  suggestion: Pick<WorkoutSuggestion, "workoutId" | "action" | "targetField">,
  adaptation: PlanAdaptation | null,
): boolean {
  if (suggestion.action !== "replace" || suggestion.targetField === "notes") return false;
  return adaptation?.heldDayIds?.has(suggestion.workoutId) === true;
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
