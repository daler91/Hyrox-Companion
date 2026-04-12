import {
  type ExerciseSet,
  exerciseSets,
  type InsertExerciseSet,
  type InsertWorkoutLog,
  planDays,
  trainingPlans,
  type UpdateWorkoutLog,
  type WorkoutLog,
  workoutLogs,
} from "@shared/schema";
import { and, asc, desc, eq, inArray,isNotNull, isNull, or, sql } from "drizzle-orm";

import { db } from "../db";
import { queryExerciseSetsWithDates } from "./shared";

export class WorkoutStorage {
  private getPlanDayCompletionCondition(planDayIds: string | string[], userId: string) {
    const ids = Array.isArray(planDayIds) ? planDayIds : [planDayIds];
    return and(
      inArray(planDays.id, ids),
      eq(planDays.planId, trainingPlans.id),
      eq(trainingPlans.userId, userId)
    );
  }

  async createWorkoutLog(log: InsertWorkoutLog & { userId: string }): Promise<WorkoutLog> {
    const [workoutLog] = await db
      .insert(workoutLogs)
      .values(log)
      .returning();

    if (log.planDayId) {
      // Bolt Optimization: Use direct JOIN via .from() instead of inArray() subquery to prevent N+1 execution
      await db
        .update(planDays)
        .set({ status: "completed" })
        .from(trainingPlans)
        .where(this.getPlanDayCompletionCondition(log.planDayId, log.userId));
    }

    return workoutLog;
  }

  async createWorkoutLogs(logs: (InsertWorkoutLog & { userId: string })[]): Promise<WorkoutLog[]> {
    if (logs.length === 0) return [];

    // Use onConflictDoNothing against the (user_id, strava_activity_id) unique
    // index (partial: WHERE strava_activity_id IS NOT NULL) so concurrent
    // Strava syncs cannot create duplicate rows for the same activity
    // (CODEBASE_AUDIT.md §5). Non-Strava inserts are unaffected because the
    // index is partial and does not cover NULL activity IDs.
    const createdLogs = await db
      .insert(workoutLogs)
      .values(logs)
      .onConflictDoNothing({
        target: [workoutLogs.userId, workoutLogs.stravaActivityId],
        where: sql`${workoutLogs.stravaActivityId} IS NOT NULL`,
      })
      .returning();

    // Group planDayIds by userId to ensure proper authorization per user
    // Since logs could potentially come from different users in a batch
    const updateConditions = [];
    const updatesByUser = new Map<string, string[]>();

    for (const log of logs) {
      if (log.planDayId) {
        const ids = updatesByUser.get(log.userId) || [];
        ids.push(log.planDayId);
        updatesByUser.set(log.userId, ids);
      }
    }

    for (const [userId, planDayIds] of updatesByUser) {
      if (planDayIds.length > 0) {
        updateConditions.push(this.getPlanDayCompletionCondition(planDayIds, userId));
      }
    }

    if (updateConditions.length > 0) {
      // Bolt Optimization: Consolidate multiple user-specific updates into a single bulk query
      // and use direct JOIN via .from() instead of inArray() subquery to prevent N+1 execution
      await db
        .update(planDays)
        .set({ status: "completed" })
        .from(trainingPlans)
        .where(or(...updateConditions));
    }

    return createdLogs;
  }

  async listWorkoutLogs(userId: string, limit?: number, offset?: number): Promise<WorkoutLog[]> {
    let query = db
      .select()
      .from(workoutLogs)
      .where(eq(workoutLogs.userId, userId))
      .orderBy(desc(workoutLogs.date))
      .$dynamic();

    if (limit !== undefined) {
      query = query.limit(limit);
    }
    if (offset !== undefined) {
      query = query.offset(offset);
    }

    return await query;
  }

  async getWorkoutLog(logId: string, userId: string): Promise<WorkoutLog | undefined> {
    const [log] = await db
      .select()
      .from(workoutLogs)
      .where(and(eq(workoutLogs.id, logId), eq(workoutLogs.userId, userId)));
    return log;
  }

  // ⚡ Bolt Performance Optimization:
  // Removed redundant pre-fetch existence check (getWorkoutLog) that duplicated
  // the same WHERE clause used by the UPDATE. The UPDATE + RETURNING already
  // yields undefined when no rows match, saving 1 DB round trip per call.
  async updateWorkoutLog(logId: string, updates: UpdateWorkoutLog, userId: string): Promise<WorkoutLog | undefined> {
    const [updatedLog] = await db
      .update(workoutLogs)
      .set(updates)
      .where(and(eq(workoutLogs.id, logId), eq(workoutLogs.userId, userId)))
      .returning();
    return updatedLog;
  }

  // ⚡ Bolt Performance Optimization:
  // Removed redundant pre-fetch existence check (getWorkoutLog) that duplicated
  // the same WHERE clause used by the DELETE. The rowCount check already returns
  // false when no rows match, saving 1 DB round trip per call.
  async deleteWorkoutLog(logId: string, userId: string): Promise<boolean> {
    const result = await db.delete(workoutLogs).where(and(eq(workoutLogs.id, logId), eq(workoutLogs.userId, userId)));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async deleteWorkoutLogByPlanDayId(planDayId: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(workoutLogs)
      .where(and(eq(workoutLogs.planDayId, planDayId), eq(workoutLogs.userId, userId)));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async getWorkoutLogByPlanDayId(planDayId: string, userId: string): Promise<WorkoutLog | undefined> {
    const [log] = await db
      .select()
      .from(workoutLogs)
      .where(and(eq(workoutLogs.planDayId, planDayId), eq(workoutLogs.userId, userId)))
      .limit(1);
    return log;
  }

  async getWorkoutByStravaActivityId(userId: string, stravaActivityId: string): Promise<WorkoutLog | undefined> {
    const [log] = await db
      .select()
      .from(workoutLogs)
      .where(and(eq(workoutLogs.userId, userId), eq(workoutLogs.stravaActivityId, stravaActivityId)));
    return log;
  }

  async getExistingStravaActivityIds(userId: string, stravaActivityIds: string[]): Promise<string[]> {
    if (stravaActivityIds.length === 0) return [];
    const rows = await db
      .select({ stravaActivityId: workoutLogs.stravaActivityId })
      .from(workoutLogs)
      .where(
        and(
          eq(workoutLogs.userId, userId),
          inArray(workoutLogs.stravaActivityId, stravaActivityIds),
          isNotNull(workoutLogs.stravaActivityId)
        )
      );
    return rows.map((r) => r.stravaActivityId as string);
  }

  /**
   * Garmin-specific bulk insert. Mirrors createWorkoutLogs but targets the
   * (user_id, garmin_activity_id) partial unique index so concurrent Garmin
   * syncs can't double-import the same activity. Routes still pre-dedupe via
   * getExistingGarminActivityIds; this is the concurrent-safety backstop.
   */
  async createGarminWorkoutLogs(logs: (InsertWorkoutLog & { userId: string })[]): Promise<WorkoutLog[]> {
    if (logs.length === 0) return [];

    const createdLogs = await db
      .insert(workoutLogs)
      .values(logs)
      .onConflictDoNothing({
        target: [workoutLogs.userId, workoutLogs.garminActivityId],
        where: sql`${workoutLogs.garminActivityId} IS NOT NULL`,
      })
      .returning();

    return createdLogs;
  }

  async getExistingGarminActivityIds(userId: string, garminActivityIds: string[]): Promise<string[]> {
    if (garminActivityIds.length === 0) return [];
    const rows = await db
      .select({ garminActivityId: workoutLogs.garminActivityId })
      .from(workoutLogs)
      .where(
        and(
          eq(workoutLogs.userId, userId),
          inArray(workoutLogs.garminActivityId, garminActivityIds),
          isNotNull(workoutLogs.garminActivityId)
        )
      );
    return rows.map((r) => r.garminActivityId as string);
  }

  async createExerciseSets(sets: InsertExerciseSet[]): Promise<ExerciseSet[]> {
    if (sets.length === 0) return [];
    return await db.insert(exerciseSets).values(sets).returning();
  }

  async getExerciseSetsByWorkoutLog(workoutLogId: string): Promise<ExerciseSet[]> {
    return await db
      .select()
      .from(exerciseSets)
      .where(eq(exerciseSets.workoutLogId, workoutLogId))
      .orderBy(asc(exerciseSets.sortOrder));
  }

  async getExerciseSetsByWorkoutLogs(workoutLogIds: string[]): Promise<ExerciseSet[]> {
    if (workoutLogIds.length === 0) return [];
    return await db
      .select()
      .from(exerciseSets)
      .where(inArray(exerciseSets.workoutLogId, workoutLogIds))
      .orderBy(asc(exerciseSets.sortOrder));
  }

  // ⚡ Bolt Performance Optimization:
  // Removed redundant pre-fetch existence check (getWorkoutLog). The DELETE's
  // subquery already includes the same userId authorization, so if the workout
  // doesn't exist or belongs to another user, zero rows are deleted (safe no-op).
  // Saves 1 DB round trip per call.
  async deleteExerciseSetsByWorkoutLog(workoutLogId: string, userId: string): Promise<boolean> {
    await db
      .delete(exerciseSets)
      .where(
        inArray(
          exerciseSets.workoutLogId,
          db.select({ id: workoutLogs.id })
            .from(workoutLogs)
            .where(and(eq(workoutLogs.id, workoutLogId), eq(workoutLogs.userId, userId)))
        )
      );
    return true;
  }

  async getExerciseHistory(userId: string, exerciseName: string): Promise<(ExerciseSet & { date: string })[]> {
    return await queryExerciseSetsWithDates(userId, { exerciseName });
  }

  async getWorkoutsWithoutExerciseSets(userId: string): Promise<WorkoutLog[]> {
    const results = await db
      .select({ workoutLog: workoutLogs })
      .from(workoutLogs)
      .leftJoin(exerciseSets, eq(workoutLogs.id, exerciseSets.workoutLogId))
      .where(
        and(
          eq(workoutLogs.userId, userId),
          isNull(exerciseSets.id),
          isNotNull(workoutLogs.mainWorkout),
          sql`TRIM(${workoutLogs.mainWorkout}) <> ''`
        )
      );
    return results.map(r => r.workoutLog);
  }
}
