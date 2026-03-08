import {
  trainingPlans,
  planDays,
  workoutLogs,
  exerciseSets,
  type ExerciseSet,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";

export class AnalyticsStorage {
  async getAllExerciseSetsWithDates(userId: string, from?: string, to?: string): Promise<(ExerciseSet & { date: string })[]> {
    const conditions = [eq(workoutLogs.userId, userId)];
    if (from) conditions.push(gte(workoutLogs.date, from));
    if (to) conditions.push(lte(workoutLogs.date, to));

    return await db
      .select({
        id: exerciseSets.id,
        workoutLogId: exerciseSets.workoutLogId,
        exerciseName: exerciseSets.exerciseName,
        customLabel: exerciseSets.customLabel,
        category: exerciseSets.category,
        setNumber: exerciseSets.setNumber,
        reps: exerciseSets.reps,
        weight: exerciseSets.weight,
        distance: exerciseSets.distance,
        time: exerciseSets.time,
        notes: exerciseSets.notes,
        confidence: exerciseSets.confidence,
        sortOrder: exerciseSets.sortOrder,
        date: workoutLogs.date,
      })
      .from(exerciseSets)
      .innerJoin(workoutLogs, eq(exerciseSets.workoutLogId, workoutLogs.id))
      .where(and(...conditions))
      .orderBy(desc(workoutLogs.date));
  }

  async getMissedWorkoutsForDate(userId: string, date: string): Promise<{ date: string; focus: string; mainWorkout: string; planName?: string }[]> {
    const results = await db
      .select({
        date: planDays.scheduledDate,
        focus: planDays.focus,
        mainWorkout: planDays.mainWorkout,
        planName: trainingPlans.name,
      })
      .from(planDays)
      .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
      .where(
        and(
          eq(trainingPlans.userId, userId),
          eq(planDays.scheduledDate, date),
          eq(planDays.status, 'missed')
        )
      );
    return results.map(r => ({
      date: r.date || date,
      focus: r.focus,
      mainWorkout: r.mainWorkout,
      planName: r.planName || undefined,
    }));
  }

  async getWeeklyStats(userId: string, weekStart: string, weekEnd: string): Promise<{ completedCount: number; plannedCount: number; missedCount: number; skippedCount: number; totalDuration: number }> {
    const logs = await db
      .select({ duration: workoutLogs.duration })
      .from(workoutLogs)
      .where(
        and(
          eq(workoutLogs.userId, userId),
          sql`${workoutLogs.date} >= ${weekStart}`,
          sql`${workoutLogs.date} <= ${weekEnd}`
        )
      );

    const days = await db
      .select({ status: planDays.status })
      .from(planDays)
      .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
      .where(
        and(
          eq(trainingPlans.userId, userId),
          sql`${planDays.scheduledDate} >= ${weekStart}`,
          sql`${planDays.scheduledDate} <= ${weekEnd}`
        )
      );

    const completedCount = logs.length;
    const plannedCount = days.filter(d => d.status === 'planned').length;
    const missedCount = days.filter(d => d.status === 'missed').length;
    const skippedCount = days.filter(d => d.status === 'skipped').length;
    const totalDuration = logs.reduce((sum, l) => sum + (l.duration || 0), 0);

    return { completedCount, plannedCount, missedCount, skippedCount, totalDuration };
  }
}
