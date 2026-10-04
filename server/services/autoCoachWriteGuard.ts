/**
 * Write-time guard for an auto-coach pass. AI16 (CODEBASE_ANALYSIS_2026-10-03)
 *
 * A pass reads the athlete's upcoming days, spends tens of seconds on model
 * calls, and only then writes, so everything it writes was computed from a
 * snapshot that may no longer hold. The athlete keeps editing while the "Coach
 * is reviewing" banner is up, and jobs from two debounce windows can run at
 * once on two instances. Inside the write transaction, before anything is
 * written:
 *
 *   1. The athlete's passes are serialized with a transaction-scoped advisory
 *      lock: a second pass waits for the first to commit, and step 2 then sees
 *      what the first one wrote.
 *   2. Every plan day the pass will write is locked (FOR UPDATE, with its
 *      prescribed sets) and compared with the snapshot it was computed from. A
 *      day that changed in between is reported stale, and the caller leaves it
 *      alone: the athlete's edit wins, and the next pass coaches the day as it
 *      now is.
 *   3. The plan adaptation is one unit (engine_state records its logs as
 *      adapted along with it), so a change to any of its days, or to the engine
 *      state itself, drops all of it. Its logs stay unadapted, and the next
 *      pass recomputes them from fresh rows rather than applying them twice.
 */
import { type ExerciseSet, exerciseSets, type PlanDay, planDays, trainingPlans } from "@shared/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { Tx } from "../db";
import type { UpcomingWorkout } from "../gemini/index";
import { logger } from "../logger";
import { deriveRaceDayOverride } from "../storage/raceDayView";
import { buildWorkoutPrescriptionFingerprint } from "./aiModificationGuard";
import type { PlanAdaptation } from "./planAdaptationService";

/** Statuses the coach's snapshot never includes (getUpcomingPlannedDays). */
const CLOSED_STATUSES = new Set(["completed", "skipped", "missed"]);

type StoredDayText = Pick<PlanDay, "accessory" | "notes"> & { mainWorkout: string | null };

/**
 * A plan day's prescription fingerprint, read from its stored row and sets the
 * same way the coach's snapshot reads them: a set's prescription falls back to
 * its planned* columns (mapUpcomingWorkout).
 */
export function fingerprintStoredPlanDay(
  day: StoredDayText,
  sets: readonly ExerciseSet[],
): string | undefined {
  return buildWorkoutPrescriptionFingerprint({
    mainWorkout: day.mainWorkout ?? "",
    accessory: day.accessory ?? undefined,
    notes: day.notes ?? undefined,
    exerciseDetails: sets.map((set) => ({
      exerciseName: set.exerciseName,
      customLabel: set.customLabel,
      category: set.category,
      setNumber: set.setNumber,
      reps: set.reps ?? set.plannedReps,
      weight: set.weight ?? set.plannedWeight,
      distance: set.distance ?? set.plannedDistance,
      time: set.time ?? set.plannedTime,
      notes: set.notes,
    })),
  });
}

interface LockedPlanDay {
  readonly day: PlanDay;
  readonly raceDate: string | null;
  readonly sets: ExerciseSet[];
}

/** Lock the athlete's plan days (and their prescribed sets) for the rest of the transaction. */
async function lockPlanDays(
  tx: Tx,
  userId: string,
  dayIds: readonly string[],
): Promise<Map<string, LockedPlanDay>> {
  const ids = [...new Set(dayIds)];
  if (ids.length === 0) return new Map();
  // Ordered, so two transactions locking overlapping days take them in turn.
  const rows = await tx
    .select({ day: planDays, raceDate: trainingPlans.raceDate })
    .from(planDays)
    .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
    .where(and(inArray(planDays.id, ids), eq(trainingPlans.userId, userId)))
    .orderBy(asc(planDays.id))
    .for("update", { of: planDays });
  const sets = await tx
    .select()
    .from(exerciseSets)
    .where(inArray(exerciseSets.planDayId, ids))
    .orderBy(asc(exerciseSets.id))
    .for("update");
  const setsByDay = new Map<string, ExerciseSet[]>();
  for (const set of sets) {
    if (!set.planDayId) continue;
    const list = setsByDay.get(set.planDayId) ?? [];
    list.push(set);
    setsByDay.set(set.planDayId, list);
  }
  return new Map(
    rows.map(({ day, raceDate }) => [day.id, { day, raceDate, sets: setsByDay.get(day.id) ?? [] }]),
  );
}

/**
 * Whether a locked day still reads as the snapshot the pass computed from. The
 * day is rebuilt the way getUpcomingPlannedDays built the snapshot: a day the
 * race date reshapes reads as its race-day text with no sets.
 */
function matchesSnapshot(snapshot: UpcomingWorkout, live: LockedPlanDay | undefined): boolean {
  if (!live) return false;
  const { day, raceDate, sets } = live;
  if (CLOSED_STATUSES.has(day.status ?? "planned") || day.scheduledDate !== snapshot.date) {
    return false;
  }
  const override = deriveRaceDayOverride(snapshot.date, raceDate);
  if ((override?.focus ?? day.focus).trim() !== snapshot.focus.trim()) return false;
  const liveFingerprint = override
    ? fingerprintStoredPlanDay(override, [])
    : fingerprintStoredPlanDay(day, sets);
  return liveFingerprint === buildWorkoutPrescriptionFingerprint(snapshot);
}

/** Lock the plan row and return its engine state's stamp; undefined when the plan is gone. */
async function lockEngineStateStamp(
  tx: Tx,
  userId: string,
  planId: string,
): Promise<string | null | undefined> {
  const [plan] = await tx
    .select({ engineState: trainingPlans.engineState })
    .from(trainingPlans)
    .where(and(eq(trainingPlans.id, planId), eq(trainingPlans.userId, userId)))
    .for("update");
  return plan ? (plan.engineState?.updatedAt ?? null) : undefined;
}

/** Whether the adaptation's engine state and every day it rewrites are as it read them. */
function adaptationStillApplies(
  adaptation: PlanAdaptation,
  engineStateStamp: string | null | undefined,
  live: Map<string, LockedPlanDay>,
): boolean {
  if (engineStateStamp !== adaptation.baseline.engineStateUpdatedAt) return false;
  return adaptation.result.days.every(({ planDayId }) => {
    const locked = live.get(planDayId);
    return (
      locked != null &&
      (locked.day.status ?? "planned") === "planned" &&
      fingerprintStoredPlanDay(locked.day, locked.sets) ===
        adaptation.baseline.dayFingerprints.get(planDayId)
    );
  });
}

export interface AutoCoachWriteTargets {
  /** The snapshots of the upcoming days the pass writes a change or a note to. */
  readonly days: readonly UpcomingWorkout[];
  readonly adaptation: PlanAdaptation | null;
}

export interface StaleAutoCoachTargets {
  /** Days that changed since the snapshot: the pass must not write them. */
  readonly dayIds: ReadonlySet<string>;
  /** The adaptation must be dropped whole. */
  readonly adaptation: boolean;
}

/**
 * Serialize the athlete's coach writes and report which of this pass's
 * targets changed since its snapshot. Call first inside the write transaction;
 * the locks hold until it commits.
 */
export async function lockAutoCoachWriteTargets(
  tx: Tx,
  userId: string,
  { days, adaptation }: AutoCoachWriteTargets,
): Promise<StaleAutoCoachTargets> {
  const lockKey = `auto-coach:${userId}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

  // One fixed lock order on every pass: the days by id (then their sets), and
  // the plan row last — the order a plan-day status change takes them in
  // (planService.updatePlanDayStatus locks the day, then its plan, in one
  // statement), so a coach pass and an athlete's "mark complete" can't
  // deadlock on each other.
  const live = await lockPlanDays(tx, userId, [
    ...days.map((day) => day.id),
    ...(adaptation?.result.days.map((day) => day.planDayId) ?? []),
  ]);
  const engineStateStamp = adaptation
    ? await lockEngineStateStamp(tx, userId, adaptation.planId)
    : undefined;
  const dayIds = new Set(
    days.filter((day) => !matchesSnapshot(day, live.get(day.id))).map((day) => day.id),
  );
  const adaptationStale =
    adaptation != null && !adaptationStillApplies(adaptation, engineStateStamp, live);

  if (dayIds.size > 0 || adaptationStale) {
    // Internal identifiers and a flag only, no workout content.
    // bearer:disable javascript_lang_logger_leak
    logger.info(
      { staleDayIds: [...dayIds], adaptationDropped: adaptationStale },
      "[coach] Plan changed during the coach pass; leaving the changed days alone",
    );
  }
  return { dayIds, adaptation: adaptationStale };
}
