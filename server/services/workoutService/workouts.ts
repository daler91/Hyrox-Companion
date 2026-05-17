import {
  customExercises,
  type ExerciseSet,
  exerciseSets,
  type InsertWorkoutLog,
  type ParsedExercise,
  planDays,
  type StructureBlockInput,
  trainingPlans,
  type UpdateWorkoutLog,
  users,
  workoutLogs,
} from "@shared/schema";
import { and, eq } from "drizzle-orm";

import { db } from "../../db";
import { logger } from "../../logger";
import { DEFAULT_JOB_OPTIONS, queue } from "../../queue";
import { storage } from "../../storage";
import { persistAdherenceSnapshot } from "./adherence";
import { expandExercisesToSetRows,extractAndDeduplicateCustomExercises } from "./setRows";
import {
  copyPrescribedSetsIntoLog,
  copyPrescribedStructureIntoLog,
  replaceWorkoutStructure,
  resolveStructureBlocksForPersist,
  structureReplacementOptions,
} from "./structure";
import type { CreateWorkoutResult, UpdateWorkoutResult, WorkoutTx } from "./types";

async function resolveActivePlanLinks(
  workoutData: InsertWorkoutLog,
  userId: string,
): Promise<{ planId?: string | null; planDayId?: string | null }> {
  if (workoutData.planDayId) {
    // Already linked to a plan day — derive planId from it
    const planDay = await storage.plans.getPlanDay(workoutData.planDayId, userId);
    if (!planDay) {
      // planDayId does not belong to this user — reject it
      return { planId: null, planDayId: null };
    }
    return { planId: planDay.planId, planDayId: workoutData.planDayId };
  }

  // Standalone workout — find the plan covering the workout's date
  if (!workoutData.date) return {};

  const plan = await storage.plans.getPlanForDate(userId, workoutData.date);
  if (!plan) return {};

  const planId = plan.id;

  // Try to auto-match to a specific plan day on the same date
  const matchingDay = await storage.plans.findMatchingPlanDay(planId, workoutData.date);
  if (matchingDay) {
    return { planId, planDayId: matchingDay.id };
  }

  return { planId };
}

// Insert a workout (+ optional exercise sets + plan-day completion + custom exercises)
// inside a caller-provided transaction. All writes are atomic with the caller's tx.
async function markPlanDayCompleted(
  tx: WorkoutTx,
  planDayId: string,
  userId: string,
): Promise<void> {
  await tx
    .update(planDays)
    .set({ status: "completed" })
    .from(trainingPlans)
    .where(
      and(
        eq(planDays.id, planDayId),
        eq(planDays.planId, trainingPlans.id),
        eq(trainingPlans.userId, userId),
      ),
    );
}

async function insertClientSuppliedExercises(
  tx: WorkoutTx,
  exercises: ParsedExercise[],
  workoutLogId: string,
  userId: string,
): Promise<ExerciseSet[]> {
  const rows = expandExercisesToSetRows(exercises, workoutLogId);
  const savedSets = await tx.insert(exerciseSets).values(rows).returning();

  const uniqueCustomExs = extractAndDeduplicateCustomExercises(exercises, userId);
  if (uniqueCustomExs.length > 0) {
    await tx.insert(customExercises).values(uniqueCustomExs).onConflictDoNothing();
  }
  return savedSets;
}

async function createWorkoutInTx(
  tx: WorkoutTx,
  enrichedData: InsertWorkoutLog,
  exercises: ParsedExercise[] | undefined,
  structureBlocks: StructureBlockInput[] | undefined,
  userId: string,
): Promise<CreateWorkoutResult> {
  const [log] = await tx
    .insert(workoutLogs)
    .values({
      ...enrichedData,
      userId,
      prescribedMainWorkout: enrichedData.mainWorkout,
      prescribedAccessory: enrichedData.accessory ?? null,
      prescribedNotes: enrichedData.notes ?? null,
    })
    .returning();

  if (enrichedData.planDayId) {
    await markPlanDayCompleted(tx, enrichedData.planDayId, userId);
  }

  let savedSets: ExerciseSet[] = [];
  let clientSuppliedSetCount = 0;
  if (exercises && Array.isArray(exercises) && exercises.length > 0) {
    savedSets = await insertClientSuppliedExercises(tx, exercises, log.id, userId);
    clientSuppliedSetCount = savedSets.length;
  } else if (enrichedData.planDayId) {
    const blockIdMap = await copyPrescribedStructureIntoLog(tx, enrichedData.planDayId, log.id);
    savedSets = await copyPrescribedSetsIntoLog(tx, enrichedData.planDayId, log.id, blockIdMap);
  }

  if (enrichedData.planDayId) {
    await persistAdherenceSnapshot(tx, log.id, enrichedData.planDayId, savedSets);
  }
  const resolvedStructure = resolveStructureBlocksForPersist({
    structureBlocks,
    exercises,
    workoutSource: enrichedData.source,
    workoutLogId: log.id,
  });
  logger.info({
    context: "workout-structure",
    event: "structure_blocks_persist_source",
    workoutLogId: log.id,
    source: resolvedStructure.source,
  }, "Persisting workout structure blocks using resolved source.");
  if (resolvedStructure.blocks !== undefined) {
    await replaceWorkoutStructure(tx, log.id, resolvedStructure.blocks, structureReplacementOptions(clientSuppliedSetCount));
  }

  if (savedSets.length > 0) return { ...log, exerciseSets: savedSets };
  return log;
}

export async function createWorkout(
  workoutData: InsertWorkoutLog,
  exercises: ParsedExercise[] | undefined,
  userId: string,
  structureBlocks?: StructureBlockInput[],
): Promise<CreateWorkoutResult> {
  // Resolve plan linkage before creating the workout
  const planLinks = await resolveActivePlanLinks(workoutData, userId);
  const enrichedData = {
    ...workoutData,
    ...(planLinks.planId !== undefined && { planId: planLinks.planId }),
    ...(planLinks.planDayId !== undefined && { planDayId: planLinks.planDayId }),
  };

  return await db.transaction((tx) => createWorkoutInTx(tx, enrichedData, exercises, structureBlocks, userId));
}

/**
 * Atomically creates a workout and flips the user's isAutoCoaching flag when
 * AI coaching is enabled, then enqueues the auto-coach job post-commit.
 *
 * Rationale (CODEBASE_AUDIT.md §4): previously the workout insert, flag
 * update, and queue enqueue were sequential and non-atomic, so a failure
 * between steps could leave the flag or queue state inconsistent with the
 * workout that had already been committed. Wrapping the DB writes in a
 * single transaction guarantees the flag matches the committed workout.
 * The queue.send stays post-commit (pg-boss has its own transaction, but
 * mixing it with the app tx needs schema changes we're intentionally
 * avoiding here); on enqueue failure we reset the flag as before.
 */
export async function createWorkoutAndScheduleCoaching(
  workoutData: InsertWorkoutLog,
  exercises: ParsedExercise[] | undefined,
  userId: string,
  structureBlocks?: StructureBlockInput[],
): Promise<CreateWorkoutResult> {
  const planLinks = await resolveActivePlanLinks(workoutData, userId);
  const enrichedData = {
    ...workoutData,
    ...(planLinks.planId !== undefined && { planId: planLinks.planId }),
    ...(planLinks.planDayId !== undefined && { planDayId: planLinks.planDayId }),
  };

  const { workout, shouldCoach } = await db.transaction(async (tx) => {
    const created = await createWorkoutInTx(tx, enrichedData, exercises, structureBlocks, userId);

    const [user] = await tx
      .select({ aiCoachEnabled: users.aiCoachEnabled })
      .from(users)
      .where(eq(users.id, userId));

    const should = user?.aiCoachEnabled === true;
    if (should) {
      await tx
        .update(users)
        .set({ isAutoCoaching: true, updatedAt: new Date() })
        .where(eq(users.id, userId));
    }

    return { workout: created, shouldCoach: should };
  });

  if (shouldCoach) {
    // Post-commit enqueue. On failure we reset the flag so the client stops
    // polling for a coaching result that will never arrive.
    // singletonKey + singletonSeconds coalesces rapid-fire workout creation
    // (e.g. bulk CSV import) into a single auto-coach invocation per user
    // within the debounce window (TECHNICAL_DEBT #23).
    queue
      .send(
        "auto-coach",
        { userId },
        { ...DEFAULT_JOB_OPTIONS, singletonKey: `auto-coach:${userId}`, singletonSeconds: 60 },
      )
      .catch((err) => {
        logger.error({ err }, "Failed to queue auto-coach job after workout creation");
        storage.users.updateIsAutoCoaching(userId, false).catch((resetErr) => {
          logger.error({ err: resetErr }, "Failed to reset isAutoCoaching flag after queue error");
        });
      });
  }

  return workout;
}

export async function updateWorkout(
  workoutId: string,
  updateData: UpdateWorkoutLog,
  exercises: ParsedExercise[] | undefined,
  userId: string,
  structureBlocks?: StructureBlockInput[],
): Promise<UpdateWorkoutResult | null> {
  if (exercises && Array.isArray(exercises)) {
    const result = await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(workoutLogs)
        .where(and(eq(workoutLogs.id, workoutId), eq(workoutLogs.userId, userId)));
      if (existing.length === 0) return null;

      const previousDate = existing[0].date;

      const [log] = await tx
        .update(workoutLogs)
        .set(updateData)
        .where(eq(workoutLogs.id, workoutId))
        .returning();

      await tx.delete(exerciseSets).where(eq(exerciseSets.workoutLogId, log.id));

      if (exercises.length > 0) {
        const exerciseSetData = expandExercisesToSetRows(exercises, log.id);
        const savedSets = await tx.insert(exerciseSets).values(exerciseSetData).returning();

        const uniqueCustomExs = extractAndDeduplicateCustomExercises(exercises, userId);

        if (uniqueCustomExs.length > 0) {
          await tx.insert(customExercises).values(uniqueCustomExs).onConflictDoNothing();
        }

        if (structureBlocks !== undefined) {
          await replaceWorkoutStructure(tx, log.id, structureBlocks, structureReplacementOptions(savedSets.length));
        }
        return { log: { ...log, exerciseSets: savedSets } as UpdateWorkoutResult, previousDate };
      }
      if (structureBlocks !== undefined) {
        await replaceWorkoutStructure(tx, log.id, structureBlocks);
      }
      return { log, previousDate };
    });

    if (!result) return null;
    maybeEnqueueAutoCoachOnDateChange(userId, result.previousDate, updateData.date);
    return result.log;
  }

  const previous = await storage.workouts.getWorkoutLog(workoutId, userId);
  if (!previous) return null;
  const result = await db.transaction(async (tx) => {
    const [log] = await tx
      .update(workoutLogs)
      .set(updateData)
      .where(and(eq(workoutLogs.id, workoutId), eq(workoutLogs.userId, userId)))
      .returning();
    if (!log) return null;
    if (structureBlocks !== undefined) {
      await replaceWorkoutStructure(tx, log.id, structureBlocks);
    }
    return log;
  });
  if (!result) return null;
  maybeEnqueueAutoCoachOnDateChange(userId, previous.date, updateData.date);
  return result;
}

// When the athlete moves a logged workout to a different day, its position in
// the recent-history window the coach reasons over shifts — rerun the coach so
// upcoming plan-day rationales stay consistent with what was actually done
// and when. Coalesced per-user with the same 60s singleton window used on
// workout create / plan-day reschedule so bursts of edits don't spam AI.
function maybeEnqueueAutoCoachOnDateChange(
  userId: string,
  previousDate: string | null | undefined,
  nextDate: string | null | undefined,
): void {
  if (nextDate === undefined) return;
  const prev = previousDate ?? null;
  const next = nextDate ?? null;
  if (prev === next) return;

  queue
    .send(
      "auto-coach",
      { userId },
      { ...DEFAULT_JOB_OPTIONS, singletonKey: `auto-coach:${userId}`, singletonSeconds: 60 },
    )
    .catch((err) =>
      logger.error({ err }, "Failed to queue auto-coach job after workout date change"),
    );
}
