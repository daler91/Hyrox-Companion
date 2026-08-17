import {
  type ExerciseLoadTag,
  exerciseLoadTags,
  planDays,
  timelineAnnotations,
  trainingPlans,
  type WorkoutLog,
  workoutLogs,
} from "@shared/schema";
import { and, desc, eq, exists, gte, inArray, lte, notExists,type SQL,sql } from "drizzle-orm";

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

  /**
   * Every plan day scheduled inside [from, to], in any status.
   *
   * The weekly review needs all four statuses from one source: counting
   * completions from `workout_logs` while counting the denominator from
   * `plan_days` is what lets a completion rate exceed 100% for an athlete who
   * trains off-plan (see getWeeklyStats, which the email tolerates because it
   * reports the counts rather than a rate). `skipReason` rides along because
   * this is its first read anywhere in the product.
   *
   * User-scoped in SQL via the parent plan, like getMissedWorkoutsForDate, so
   * it stays an indexed lookup over one athlete's plans.
   */
  async getPlanDaysByDateRange(
    userId: string,
    from: string,
    to: string,
  ): Promise<{ id: string; date: string; focus: string; status: string; skipReason: string | null; planName: string | null }[]> {
    const days = await db
      .select({
        id: planDays.id,
        scheduledDate: planDays.scheduledDate,
        focus: planDays.focus,
        status: planDays.status,
        skipReason: planDays.skipReason,
        planName: trainingPlans.name,
      })
      .from(planDays)
      .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
      .where(
        and(
          eq(trainingPlans.userId, userId),
          gte(planDays.scheduledDate, from),
          lte(planDays.scheduledDate, to),
        ),
      );

    return days
      // scheduledDate is nullable in the schema (an unscheduled plan day), but
      // the range predicate above cannot match a NULL — the filter is for the
      // type, not for the data.
      .filter((d): d is typeof d & { scheduledDate: string } => d.scheduledDate !== null)
      .map((d) => ({
        id: d.id,
        date: d.scheduledDate,
        focus: d.focus,
        status: d.status ?? "planned",
        skipReason: d.skipReason,
        planName: d.planName,
      }));
  }

  async getMissedWorkoutsForDate(userId: string, date: string): Promise<{ planDayId: string; date: string; focus: string; mainWorkout: string; planName?: string }[]> {
    // Scoped to the plan owner in SQL via the join, not in memory: this runs
    // once per user per day (one send-missed-reminder job each), so filtering
    // after the fetch made every user's job read *every other* user's missed
    // days for that date — O(users²) rows across the daily run. The join uses
    // the existing idx_training_plans_user_id / idx_plan_days_plan_scheduled
    // indexes, so each call is now an indexed lookup over one user's plans.
    // `id` rides along so the missed-workout push can deep link straight to
    // the session (`/?workout=<planDayId>`) instead of dumping the athlete on
    // the timeline root.
    //
    // Nothing is sent for a date the athlete has declared an absence over. The
    // sweep already leaves those days `planned`, but the check is repeated here
    // rather than inferred from that: an annotation written *after* the sweep
    // ran finds the day already stored as `missed`, and "you missed yesterday's
    // session" is the worst possible thing to email someone on day two of an
    // injury they have already logged.
    const days = await db
      .select({
        id: planDays.id,
        scheduledDate: planDays.scheduledDate,
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
          eq(planDays.status, "missed"),
          notExists(
            db
              .select({ one: sql`1` })
              .from(timelineAnnotations)
              .where(
                and(
                  eq(timelineAnnotations.userId, userId),
                  lte(timelineAnnotations.startDate, date),
                  gte(timelineAnnotations.endDate, date),
                ),
              ),
          ),
        ),
      );
    return days.map((d) => ({
      planDayId: d.id,
      date: d.scheduledDate || date,
      focus: d.focus,
      mainWorkout: d.mainWorkout,
      planName: d.planName || undefined,
    }));
  }

  /**
   * Planned (not-yet-logged) plan days scheduled for `date`, for the per-meal
   * fuelling targets: their expected duration/effort drive a morning session's
   * fuel anchors before the workout is logged. User-scoped in SQL via the
   * parent plan (like getMissedWorkoutsForDate); `status = 'planned'`
   * excludes completed/missed/skipped days (a completed day already has a log).
   */
  async getPlannedDaysForDate(userId: string, date: string): Promise<{ focus: string; expectedDurationMin: number | null; expectedRpe: number | null; plannedTimeOfDayMin: number | null }[]> {
    // Same join-scoping as getMissedWorkoutsForDate: this one is hit on every
    // meal-log request, where the in-memory filter made a single user's meal
    // log scan all users' planned days for that date.
    const days = await db
      .select({
        focus: planDays.focus,
        expectedDurationMin: planDays.expectedDurationMin,
        expectedRpe: planDays.expectedRpe,
        plannedTimeOfDayMin: planDays.plannedTimeOfDayMin,
      })
      .from(planDays)
      .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
      .where(
        and(
          eq(trainingPlans.userId, userId),
          eq(planDays.scheduledDate, date),
          eq(planDays.status, "planned"),
        ),
      );
    return days.map((d) => ({
      focus: d.focus,
      expectedDurationMin: d.expectedDurationMin ?? null,
      expectedRpe: d.expectedRpe ?? null,
      plannedTimeOfDayMin: d.plannedTimeOfDayMin ?? null,
    }));
  }

  /**
   * The weekly summary email's counts (its only caller — `processWeeklySummary`
   * reports the most recently COMPLETED week, which the excused split below
   * relies on: with every day of the week in the past, "held out of missed by a
   * declared absence" collapses to annotation coverage, no today needed).
   */
  async getWeeklyStats(userId: string, weekStart: string, weekEnd: string): Promise<{ completedCount: number; plannedCount: number; missedCount: number; skippedCount: number; excusedCount: number; totalDuration: number }> {
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

    // Days a declared absence holds out of "missed" — the same rule as the
    // weekly review's counts and the timeline's "Not counted" badge. They can
    // sit under either status: `missed` when the sweep ran before the athlete
    // logged the annotation, `planned` when it ran after (the sweep skips
    // covered days). Grouped by status so each can be subtracted from the
    // bucket the raw counts put it in. "You missed 3 sessions this week" on
    // the Monday after an injury the athlete already logged is the exact
    // email this exists to prevent.
    const excusedRows = await db
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
          sql`${planDays.scheduledDate} <= ${weekEnd}`,
          inArray(planDays.status, ["planned", "missed"]),
          exists(
            db
              .select({ one: sql`1` })
              .from(timelineAnnotations)
              .where(
                and(
                  eq(timelineAnnotations.userId, userId),
                  lte(timelineAnnotations.startDate, planDays.scheduledDate),
                  gte(timelineAnnotations.endDate, planDays.scheduledDate),
                ),
              ),
          ),
        ),
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

    let excusedCount = 0;
    for (const row of excusedRows) {
      excusedCount += row.count;
      if (row.status === 'missed') {
        missedCount -= row.count;
      } else {
        plannedCount -= row.count;
      }
    }

    return { completedCount, plannedCount, missedCount, skippedCount, excusedCount, totalDuration };
  }
}
