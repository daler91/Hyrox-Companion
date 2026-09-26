import {
  type ExerciseLoadTag,
  exerciseLoadTags,
  planDays,
  timelineAnnotations,
  trainingPlans,
  type WorkoutLog,
  workoutLogs,
} from "@shared/schema";
import { resolveSessionPriority } from "@shared/sessionPriority";
import { and, asc, desc, eq, gte, inArray, lte, not, notExists,or,type SQL,sql } from "drizzle-orm";

import { db } from "../db";
import { logger } from "../logger";
import { absenceDeclaredForPlanDay, noAbsenceDeclaredForUserDate } from "./absenceGuard";
import { planDayLetGo } from "./letGoGuard";
import { planDayWithinPlanLifetime } from "./planRetirement";
import { type LoggedExerciseSetWithDate, MAX_WORKOUT_LOGS_PER_QUERY, queryExerciseSetsWithDates, querySlimExerciseSetsWithDates, type SlimLoggedExerciseSet } from "./shared";

/** A not-yet-logged plan day on a given date, as the session brief email reads it. */
export interface PlannedSessionForDate {
  /** The `plan_days` row id — what `?workout=` deep links to. */
  planDayId: string;
  focus: string;
  mainWorkout: string;
  expectedDurationMin: number | null;
  expectedRpe: number | null;
  /** Minutes after local midnight the session is planned for, when set. */
  plannedTimeOfDayMin: number | null;
  planName: string | null;
}

export class AnalyticsStorage {
  // ⚡ Bolt Performance Optimization: exercise_load_tags is static reference
  // data (per-exercise biomechanical multipliers, keyed by exerciseName) with
  // no runtime write path anywhere in the app — it's only ever populated by a
  // migration, so it cannot go stale for the life of this process. Despite
  // that, every AI coach-turn context build, nutrition daily-load calc (x2),
  // race prediction, plan generation, and the training overview loader each
  // fire their own unfiltered `SELECT * FROM exercise_load_tags` on every
  // call — often several of those on the very same request. Caching the
  // in-flight promise (not just the resolved value) means the first caller
  // after a cold start pays one query and every concurrent/later caller in
  // this process reuses it instead of issuing a fresh round trip. A failed
  // fetch clears the cache so a transient DB error doesn't pin a rejection
  // forever. Callers only ever read the array (see calculateTrainingLoad's
  // `readonly ExerciseLoadTag[]` param), so sharing one reference is safe.
  private loadTagsCache: Promise<ExerciseLoadTag[]> | null = null;

  async getExerciseLoadTags(): Promise<ExerciseLoadTag[]> {
    this.loadTagsCache ??= this.fetchExerciseLoadTags();
    try {
      return await this.loadTagsCache;
    } catch (err) {
      this.loadTagsCache = null;
      throw err;
    }
  }

  private async fetchExerciseLoadTags(): Promise<ExerciseLoadTag[]> {
    return await db.select().from(exerciseLoadTags);
  }

  /** `onlyTraining` — see the note on getWorkoutLogsByDateRange; opt-in for the
   *  same reason (the nutrition load calc reads every session's sets). */
  async getAllExerciseSetsWithDates(
    userId: string,
    from?: string,
    to?: string,
    options?: { onlyTraining?: boolean },
  ): Promise<LoggedExerciseSetWithDate[]> {
    return await queryExerciseSetsWithDates(userId, { from, to, onlyTraining: options?.onlyTraining });
  }

  // Column-slim fetch for the Personal Records endpoint (only the fields
  // calculatePersonalRecords reads), so the all-time PR query doesn't hydrate
  // full set rows (incl. JSON columns) for tens of thousands of sets.
  async getExerciseSetsForPersonalRecords(
    userId: string,
    from?: string,
    to?: string,
    options?: { onlyTraining?: boolean },
  ): Promise<SlimLoggedExerciseSet[]> {
    return await querySlimExerciseSetsWithDates(userId, { from, to, onlyTraining: options?.onlyTraining });
  }

  /**
   * `onlyTraining` drops the sessions the athlete does not count as training
   * (walks, yoga, commutes — see `workout_logs.counts_as_training`).
   *
   * OPT-IN, and it has to stay that way: this one method feeds the training
   * overview, the weekly review, the home card, the AI context AND the
   * nutrition energy balance, and the last of those must keep seeing every
   * session. A walk's calories are real expenditure; filtering them here by
   * default would silently corrupt the day's energy balance
   * (services/nutrition/energy.ts reads `calories` off this same call).
   */
  async getWorkoutLogsByDateRange(
    userId: string,
    from?: string,
    to?: string,
    options?: { onlyTraining?: boolean },
  ): Promise<WorkoutLog[]> {
    const conditions: SQL[] = [eq(workoutLogs.userId, userId)];
    if (from) conditions.push(gte(workoutLogs.date, from));
    if (to) conditions.push(lte(workoutLogs.date, to));
    if (options?.onlyTraining) conditions.push(eq(workoutLogs.countsAsTraining, true));

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
      // userId is the app-wide
      // correlation id; limit is a constant and from/to are date strings. No
      // PII or secrets (mirrors the sibling warn in storage/shared.ts).
      // bearer:disable javascript_lang_logger_leak
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
   * trains off-plan. `getWeeklyStats` used to do exactly that and the email
   * DID turn it into a rate, so an athlete with no plan was emailed 100%
   * (audit H6); it now returns `planCompletedCount` so that rate can be built
   * from plan days alone. `skipReason` rides along because this is its first
   * read anywhere in the product.
   *
   * User-scoped in SQL via the parent plan, like getMissedWorkoutsForDate, so
   * it stays an indexed lookup over one athlete's plans.
   */
  async getPlanDaysByDateRange(
    userId: string,
    from: string,
    to: string,
  ): Promise<{ id: string; date: string; focus: string; mainWorkout: string; status: string; skipReason: string | null; priority: string | null; recovery: string | null; planName: string | null }[]> {
    const days = await db
      .select({
        id: planDays.id,
        scheduledDate: planDays.scheduledDate,
        focus: planDays.focus,
        mainWorkout: planDays.mainWorkout,
        status: planDays.status,
        skipReason: planDays.skipReason,
        priority: planDays.priority,
        recovery: planDays.recovery,
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
        mainWorkout: d.mainWorkout,
        status: d.status ?? "planned",
        skipReason: d.skipReason,
        priority: d.priority,
        recovery: d.recovery,
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
    //
    // Nor for a session nobody should be chased about: one the athlete already
    // let go (they can open the app before the reminder goes out), an optional
    // one (the plan does not need it back), or a rest day — "You missed: Rest"
    // was never a sentence worth sending. The tier is inferred from the title
    // for days the athlete never marked, which SQL cannot do, so that part of
    // the filter runs on the (at most a handful of) rows below.
    const days = await db
      .select({
        id: planDays.id,
        scheduledDate: planDays.scheduledDate,
        focus: planDays.focus,
        mainWorkout: planDays.mainWorkout,
        priority: planDays.priority,
        recovery: planDays.recovery,
        planName: trainingPlans.name,
      })
      .from(planDays)
      .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
      .where(
        and(
          eq(trainingPlans.userId, userId),
          eq(planDays.scheduledDate, date),
          eq(planDays.status, "missed"),
          noAbsenceDeclaredForUserDate(db, userId, date),
        ),
      );
    return days
      .filter((d) => {
        if (d.recovery === "let_go") return false;
        const priority = resolveSessionPriority(d);
        return priority !== null && priority !== "optional";
      })
      .map((d) => ({
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
   * The sessions still `planned` on `date`, for the session brief email.
   *
   * A sibling of getPlannedDaysForDate rather than an extension of it: that
   * one feeds the per-meal fuel targets and must keep its shape. This one
   * carries the id (for the deep link), the workout text and the plan name,
   * and applies two guards the brief needs and the fuel targets do not —
   * days of a retired plan are not proposed (planDayWithinPlanLifetime), and
   * nothing is proposed on a date the athlete has declared an absence over,
   * the same rule getMissedWorkoutsForDate applies to the missed reminder.
   */
  async getPlannedSessionsForDate(userId: string, date: string): Promise<PlannedSessionForDate[]> {
    const days = await db
      .select({
        id: planDays.id,
        focus: planDays.focus,
        mainWorkout: planDays.mainWorkout,
        expectedDurationMin: planDays.expectedDurationMin,
        expectedRpe: planDays.expectedRpe,
        plannedTimeOfDayMin: planDays.plannedTimeOfDayMin,
        planName: trainingPlans.name,
      })
      .from(planDays)
      .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
      .where(
        and(
          eq(trainingPlans.userId, userId),
          eq(planDays.scheduledDate, date),
          eq(planDays.status, "planned"),
          planDayWithinPlanLifetime(),
          noAbsenceDeclaredForUserDate(db, userId, date),
        ),
      )
      .orderBy(sql`${planDays.plannedTimeOfDayMin} ASC NULLS LAST`, asc(planDays.id));
    return days.map((d) => ({
      planDayId: d.id,
      focus: d.focus,
      mainWorkout: d.mainWorkout,
      expectedDurationMin: d.expectedDurationMin ?? null,
      expectedRpe: d.expectedRpe ?? null,
      plannedTimeOfDayMin: d.plannedTimeOfDayMin ?? null,
      planName: d.planName ?? null,
    }));
  }

  /**
   * How many plan sessions were DUE in [from, to] — the denominator "Avg
   * Adherence" needs.
   *
   * That figure used to divide the sum of per-session `compliancePct` by the
   * number of sessions the athlete actually LOGGED, so skipping the plan
   * removed sessions from its own denominator and drove adherence toward 100%:
   * complete one session at 90% and skip the other four, and the athlete was
   * shown 90% (audit H10).
   *
   * Due means: finished, missed or skipped, plus days still marked `planned`
   * whose date has already passed (`dueThrough`). A planned day still in the
   * future is not yet due and must not count against the athlete. Days covered
   * by a declared absence are excluded entirely, matching the weekly email and
   * the timeline's "Not counted" badge — a week spent injured is not a week of
   * failures. So are missed days the athlete let go ({@link planDayLetGo}):
   * dropping a session on purpose is adjusting the plan, not falling short of it.
   *
   * Sessions from a retired plan's cutoff onward are excluded for the same
   * reason. This query joins plan_days to training_plans on the USER, so before
   * the lifecycle column existed an athlete who switched goals mid-block kept the
   * weeks they walked away from in their denominator forever — adherence fell for
   * training they had deliberately stopped doing. The stretch before the cutoff
   * still counts: they were genuinely training it.
   */
  async getDueSessionCount(userId: string, from: string, to: string, dueThrough: string): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(planDays)
      .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
      .where(
        and(
          eq(trainingPlans.userId, userId),
          sql`${planDays.scheduledDate} >= ${from}`,
          sql`${planDays.scheduledDate} <= ${to}`,
          planDayWithinPlanLifetime(),
          or(
            inArray(planDays.status, ["completed", "missed", "skipped"]),
            and(eq(planDays.status, "planned"), sql`${planDays.scheduledDate} <= ${dueThrough}`),
          ),
          not(planDayLetGo()),
          notExists(
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
      );
    return row?.count ?? 0;
  }

  /**
   * The weekly summary email's counts (its only caller — `processWeeklySummary`
   * reports the most recently COMPLETED week, which the excused split below
   * relies on: with every day of the week in the past, "held out of missed by a
   * declared absence" collapses to annotation coverage, no today needed).
   */
  async getWeeklyStats(userId: string, weekStart: string, weekEnd: string): Promise<{ completedCount: number; planCompletedCount: number; plannedCount: number; missedCount: number; skippedCount: number; excusedCount: number; letGoCount: number; totalDuration: number }> {
    const [logs] = await db
      .select({
        completedCount: sql<number>`cast(count(*) as int)`,
        totalDuration: sql<number>`cast(sum(${workoutLogs.duration}) as int)`,
      })
      .from(workoutLogs)
      .where(
        and(
          eq(workoutLogs.userId, userId),
          // The email says "you trained N times this week" — walks and yoga are
          // not what it means.
          eq(workoutLogs.countsAsTraining, true),
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
          absenceDeclaredForPlanDay(db, userId),
        ),
      )
      .groupBy(planDays.status);

    // Missed days the athlete let go: out of "missed" like an excused day, and
    // out of the completion rate. One inside a declared absence is already
    // excused above, and is not taken off a second time.
    const [letGo = { count: 0 }] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(planDays)
      .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
      .where(
        and(
          eq(trainingPlans.userId, userId),
          sql`${planDays.scheduledDate} >= ${weekStart}`,
          sql`${planDays.scheduledDate} <= ${weekEnd}`,
          planDayLetGo(),
          not(absenceDeclaredForPlanDay(db, userId)),
        ),
      );

    const completedCount = logs?.completedCount || 0;
    const totalDuration = logs?.totalDuration || 0;
    const letGoCount = letGo.count;

    let plannedCount = 0;
    let missedCount = 0;
    let skippedCount = 0;
    // Plan days the athlete actually completed. The group-by has always
    // returned this status and the loop has always dropped it, which is why
    // the email had to reach into `workout_logs` for a numerator and ended up
    // dividing one table by another (audit H6).
    let planCompletedCount = 0;

    for (const day of days) {
      if (day.status === 'planned') {
        plannedCount = day.count;
      } else if (day.status === 'missed') {
        missedCount = day.count;
      } else if (day.status === 'skipped') {
        skippedCount = day.count;
      } else if (day.status === 'completed') {
        planCompletedCount = day.count;
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

    missedCount -= letGoCount;

    return { completedCount, planCompletedCount, plannedCount, missedCount, skippedCount, excusedCount, letGoCount, totalDuration };
  }
}
