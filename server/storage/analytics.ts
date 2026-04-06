import {
  type ExerciseSet,
  planDays,
  trainingPlans,
  type WorkoutLog,
  workoutLogs,
} from "@shared/schema";
import { and, desc, eq, gte, lte, type SQL,sql } from "drizzle-orm";

import { db } from "../db";
import { queryExerciseSetsWithDates } from "./shared";

export class AnalyticsStorage {
  async getAllExerciseSetsWithDates(userId: string, from?: string, to?: string): Promise<(ExerciseSet & { date: string })[]> {
    return await queryExerciseSetsWithDates(userId, { from, to });
  }

  async getWorkoutLogsByDateRange(userId: string, from?: string, to?: string): Promise<WorkoutLog[]> {
    const conditions: SQL[] = [eq(workoutLogs.userId, userId)];
    if (from) conditions.push(gte(workoutLogs.date, from));
    if (to) conditions.push(lte(workoutLogs.date, to));

    return await db
      .select()
      .from(workoutLogs)
      .where(and(...conditions))
      .orderBy(desc(workoutLogs.date));
  }

  async getMissedWorkoutsForDate(userId: string, date: string): Promise<{ date: string; focus: string; mainWorkout: string; planName?: string }[]> {
    // Relational query: fetch missed plan days for the date, include the parent
    // plan's name, and filter by plan owner in memory. The `plan` relation's
    // inner row presence is implied by the NOT NULL FK, so the filter is safe.
    const days = await db.query.planDays.findMany({
      where: and(
        eq(planDays.scheduledDate, date),
        eq(planDays.status, "missed"),
      ),
      columns: {
        scheduledDate: true,
        focus: true,
        mainWorkout: true,
      },
      with: {
        plan: {
          columns: { userId: true, name: true },
        },
      },
    });
    return days
      .filter((d) => d.plan?.userId === userId)
      .map((d) => ({
        date: d.scheduledDate || date,
        focus: d.focus,
        mainWorkout: d.mainWorkout,
        planName: d.plan?.name || undefined,
      }));
  }

  async getWeeklyStats(userId: string, weekStart: string, weekEnd: string): Promise<{ completedCount: number; plannedCount: number; missedCount: number; skippedCount: number; totalDuration: number }> {
    const [logs] = await db
      .select({
        completedCount: sql<number>`cast(count(*) as int)`,
        totalDuration: sql<number>`cast(sum(${workoutLogs.duration}) as int)`,
      })
      .from(workoutLogs)
      .where(
        and(
          eq(workoutLogs.userId, userId),
          sql`${workoutLogs.date} >= ${weekStart}`,
          sql`${workoutLogs.date} <= ${weekEnd}`
        )
      );

    const days = await db
      .select({
        status: planDays.status,
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(planDays)
      .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
      .where(
        and(
          eq(trainingPlans.userId, userId),
          sql`${planDays.scheduledDate} >= ${weekStart}`,
          sql`${planDays.scheduledDate} <= ${weekEnd}`
        )
      )
      .groupBy(planDays.status);

    const completedCount = logs?.completedCount || 0;
    const totalDuration = logs?.totalDuration || 0;

    let plannedCount = 0;
    let missedCount = 0;
    let skippedCount = 0;

    for (const day of days) {
      if (day.status === 'planned') {
        plannedCount = day.count;
      } else if (day.status === 'missed') {
        missedCount = day.count;
      } else if (day.status === 'skipped') {
        skippedCount = day.count;
      }
    }

    return { completedCount, plannedCount, missedCount, skippedCount, totalDuration };
  }
}
