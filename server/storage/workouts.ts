import {
  workoutLogs,
  planDays,
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
      await db
        .update(planDays)
        .set({ status: "completed" })
        .where(eq(planDays.id, log.planDayId));
    }

    return workoutLog;
  }

  async listWorkoutLogs(userId: string): Promise<WorkoutLog[]> {
    return await db
      .select()
      .from(workoutLogs)
      .where(eq(workoutLogs.userId, userId))
      .orderBy(desc(workoutLogs.date));
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
      .where(eq(workoutLogs.id, logId))
      .returning();
    return updatedLog;
  }

  async deleteWorkoutLog(logId: string, userId: string): Promise<boolean> {
    const existingLog = await this.getWorkoutLog(logId, userId);
    if (!existingLog) return false;
    
    const result = await db.delete(workoutLogs).where(eq(workoutLogs.id, logId));
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
      .where(eq(exerciseSets.workoutLogId, workoutLogId));
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
