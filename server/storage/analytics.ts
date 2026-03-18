import {
  trainingPlans,
  planDays,
  workoutLogs,

  type ExerciseSet,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { queryExerciseSetsWithDates } from "./shared";

export class AnalyticsStorage {
  async getAllExerciseSetsWithDates(userId: string, from?: string, to?: string): Promise<(ExerciseSet & { date: string })[]> {
    return await queryExerciseSetsWithDates(userId, { from, to });
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

    // ⚡ Bolt Performance Optimization:
    // Instead of multiple O(N) array filters and reduces to compute stats, we iterate
    // over the arrays exactly once. This reduces overhead, especially
    // for users with long workout histories.
    let plannedCount = 0;
    let missedCount = 0;
    let skippedCount = 0;

    for (const day of days) {
      const status = day.status;
      if (status === 'planned') {
        plannedCount++;
      } else if (status === 'missed') {
        missedCount++;
      } else if (status === 'skipped') {
        skippedCount++;
      }
    }

    let totalDuration = 0;
    for (const log of logs) {
      totalDuration += log.duration || 0;
    }

    return { completedCount, plannedCount, missedCount, skippedCount, totalDuration };
  }
}
