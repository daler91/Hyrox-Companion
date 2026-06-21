import {
  type ExerciseLoadTag,
  exerciseLoadTags,
  planDays,
  trainingPlans,
  type WorkoutLog,
  workoutLogs,
} from "@shared/schema";
import { and, desc, eq, gte, lte, type SQL,sql } from "drizzle-orm";

import { db } from "../db";
import { logger } from "../logger";
import { type LoggedExerciseSetWithDate, MAX_WORKOUT_LOGS_PER_QUERY, queryExerciseSetsWithDates, querySlimExerciseSetsWithDates, type SlimLoggedExerciseSet } from "./shared";

export class AnalyticsStorage {
  async getExerciseLoadTags(): Promise<ExerciseLoadTag[]> {
    return await db.select().from(exerciseLoadTags);
  }

  async getAllExerciseSetsWithDates(userId: string, from?: string, to?: string): Promise<LoggedExerciseSetWithDate[]> {
    return await queryExerciseSetsWithDates(userId, { from, to });
  }

  // Column-slim fetch for the Personal Records endpoint (only the fields
  // calculatePersonalRecords reads), so the all-time PR query doesn't hydrate
  // full set rows (incl. JSON columns) for tens of thousands of sets.
  async getExerciseSetsForPersonalRecords(userId: string, from?: string, to?: string): Promise<SlimLoggedExerciseSet[]> {
    return await querySlimExerciseSetsWithDates(userId, { from, to });
  }

  async getWorkoutLogsByDateRange(userId: string, from?: string, to?: string): Promise<WorkoutLog[]> {
    const conditions: SQL[] = [eq(workoutLogs.userId, userId)];
    if (from) conditions.push(gte(workoutLogs.date, from));
    if (to) conditions.push(lte(workoutLogs.date, to));

    // Cap the result like its sibling queryExerciseSetsWithDates (W10): the
    // "all time" analytics view passes no date range, so without a limit this
    // returns the user's entire workout_logs table. 5000 covers ~14 years of
    // daily training; warn on truncation so we can offer pagination if hit.
    const logs = await db
      .select()
      .from(workoutLogs)
      .where(and(...conditions))
      .orderBy(desc(workoutLogs.date))
      .limit(MAX_WORKOUT_LOGS_PER_QUERY);

    if (logs.length >= MAX_WORKOUT_LOGS_PER_QUERY) {
      // bearer:disable javascript_lang_logger_leak — userId is the app-wide
      // correlation id; limit is a constant and from/to are date strings. No
      // PII or secrets (mirrors the sibling warn in storage/shared.ts).
      logger.warn(
        { userId, limit: MAX_WORKOUT_LOGS_PER_QUERY, from, to },
        "getWorkoutLogsByDateRange hit row cap — analytics may be truncated; consider narrowing the date range",
      );
    }

    return logs;
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

  /**
   * Planned (not-yet-logged) plan days scheduled for `date`, for the per-meal
   * fuelling targets: their expected duration/effort drive a morning session's
   * fuel anchors before the workout is logged. User-scoped via the parent plan
   * (filtered in memory like getMissedWorkoutsForDate); `status = 'planned'`
   * excludes completed/missed/skipped days (a completed day already has a log).
   */
  async getPlannedDaysForDate(userId: string, date: string): Promise<{ focus: string; expectedDurationMin: number | null; expectedRpe: number | null; plannedTimeOfDayMin: number | null }[]> {
    const days = await db.query.planDays.findMany({
      where: and(eq(planDays.scheduledDate, date), eq(planDays.status, "planned")),
      columns: { focus: true, expectedDurationMin: true, expectedRpe: true, plannedTimeOfDayMin: true },
      with: { plan: { columns: { userId: true } } },
    });
    return days
      .filter((d) => d.plan?.userId === userId)
      .map((d) => ({
        focus: d.focus,
        expectedDurationMin: d.expectedDurationMin ?? null,
        expectedRpe: d.expectedRpe ?? null,
        plannedTimeOfDayMin: d.plannedTimeOfDayMin ?? null,
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
