import {
  workoutLogs,
  planDays,
  trainingPlans,
  exerciseSets,
  type WorkoutLog,
  type InsertWorkoutLog,
  type UpdateWorkoutLog,
  type ExerciseSet,
  type InsertExerciseSet,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, desc, asc, isNull, isNotNull, sql, inArray } from "drizzle-orm";
import { queryExerciseSetsWithDates } from "./shared";

export class WorkoutStorage {
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
        .where(
          and(
            eq(planDays.id, log.planDayId),
            eq(planDays.planId, trainingPlans.id),
            eq(trainingPlans.userId, log.userId)
          )
        );
    }

    return workoutLog;
  }

  async createWorkoutLogs(logs: (InsertWorkoutLog & { userId: string })[]): Promise<WorkoutLog[]> {
    if (logs.length === 0) return [];

    const createdLogs = await db
      .insert(workoutLogs)
      .values(logs)
      .returning();

    // Group planDayIds by userId to ensure proper authorization per user
    // Since logs could potentially come from different users in a batch
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
        // Bolt Optimization: Use direct JOIN via .from() instead of inArray() subquery to prevent N+1 execution
        await db
          .update(planDays)
          .set({ status: "completed" })
          .from(trainingPlans)
          .where(
            and(
              inArray(planDays.id, planDayIds),
              eq(planDays.planId, trainingPlans.id),
              eq(trainingPlans.userId, userId)
            )
          );
      }
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

  async updateWorkoutLog(logId: string, updates: UpdateWorkoutLog, userId: string): Promise<WorkoutLog | undefined> {
    const existingLog = await this.getWorkoutLog(logId, userId);
    if (!existingLog) return undefined;
    
    const [updatedLog] = await db
      .update(workoutLogs)
      .set(updates)
      .where(and(eq(workoutLogs.id, logId), eq(workoutLogs.userId, userId)))
      .returning();
    return updatedLog;
  }

  async deleteWorkoutLog(logId: string, userId: string): Promise<boolean> {
    const existingLog = await this.getWorkoutLog(logId, userId);
    if (!existingLog) return false;
    
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

  async deleteExerciseSetsByWorkoutLog(workoutLogId: string, userId: string): Promise<boolean> {
    const existingLog = await this.getWorkoutLog(workoutLogId, userId);
    if (!existingLog) return false;

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
