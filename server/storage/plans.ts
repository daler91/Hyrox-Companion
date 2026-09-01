import { addDaysToISODate } from "@shared/dateUtils";
import {
  type InsertPlanDay,
  type InsertTrainingPlan,
  type PlanDay,
  planDays,
  type TrainingPlan,
  trainingPlans,
  type TrainingPlanWithDays,
  type UpdatePlanDay,
  users,
} from "@shared/schema";
import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, sql } from "drizzle-orm";

import { db, type DbExecutor } from "../db";
import { logger } from "../logger";
import { getLocalDateStrSafe } from "../timezone";
import { noAbsenceDeclaredForPlanDay } from "./absenceGuard";
import { syncPlanDayStatusFromWorkouts } from "./planDayStatus";
import { missedSweepRetirementGuard, planLiveForDate } from "./planRetirement";

// Re-export for callers that already reach for it via PlanStorage's neighbours.
export { syncPlanDayStatusFromWorkouts } from "./planDayStatus";

export class PlanStorage {
  async createTrainingPlan(plan: InsertTrainingPlan, tx?: DbExecutor): Promise<TrainingPlan> {
    const executor = tx ?? db;
    const [trainingPlan] = await executor.insert(trainingPlans).values(plan).returning();
    return trainingPlan;
  }

  async updateGenerationStatus(
    planId: string,
    status: "pending" | "generating" | "ready" | "failed",
    generationError?: string | null,
    tx?: DbExecutor,
  ): Promise<void> {
    await (tx ?? db)
      .update(trainingPlans)
      .set({ generationStatus: status, generationError: generationError ?? null })
      .where(eq(trainingPlans.id, planId));
  }

  /**
   * True when the user already has a plan whose AI generation is in flight
   * (`pending` or `generating`). Used to reject duplicate `/plans/generate`
   * requests (W13) with a friendly 409 before any work happens. The airtight
   * half is the DB: `uq_training_plans_user_in_flight` (migration 0091) makes
   * a second concurrent INSERT fail with 23505, which the route maps to the
   * same 409 — so this check is a fast path, not the guarantee.
   */
  async hasInFlightPlanGeneration(userId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: trainingPlans.id })
      .from(trainingPlans)
      .where(
        and(
          eq(trainingPlans.userId, userId),
          inArray(trainingPlans.generationStatus, ["pending", "generating"]),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /**
   * Every plan the athlete owns, retired ones included — the plan selector needs
   * them to offer a restore, and the timeline needs them to render history. It is
   * the read paths that ask "what is the athlete training NOW?" that filter, not
   * this one.
   *
   * Ordered live-first then newest-first. Previously unordered, so the selector
   * listed plans in whatever order Postgres happened to return them.
   */
  async listTrainingPlans(userId: string): Promise<TrainingPlan[]> {
    return await db
      .select()
      .from(trainingPlans)
      .where(eq(trainingPlans.userId, userId))
      .orderBy(
        sql`CASE WHEN ${trainingPlans.retiredOn} IS NULL THEN 0 ELSE 1 END`,
        sql`${trainingPlans.startDate} DESC NULLS LAST`,
      );
  }

  async getTrainingPlan(planId: string, userId: string): Promise<TrainingPlanWithDays | undefined> {
    const [plan] = await db
      .select()
      .from(trainingPlans)
      .where(and(eq(trainingPlans.id, planId), eq(trainingPlans.userId, userId)));

    if (!plan) return undefined;

    const days = await db.select().from(planDays).where(eq(planDays.planId, planId));

    // Case-insensitive day ordering matches the tolerant lookup used in
    // schedulePlan(), so legacy rows with non-title-case dayName values
    // (e.g. "monday" from older imports) still sort Mon→Sun instead of
    // falling back to insertion order.
    const dayOrder = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    const dayIndex = (name: string) => dayOrder.indexOf((name ?? "").trim().toLowerCase());
    days.sort((a, b) => {
      if (a.weekNumber !== b.weekNumber) return a.weekNumber - b.weekNumber;
      const aIndex = dayIndex(a.dayName);
      const bIndex = dayIndex(b.dayName);
      if (aIndex === -1 && bIndex === -1) return 0;
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });

    return { ...plan, days };
  }

  async renameTrainingPlan(
    planId: string,
    name: string,
    userId: string,
  ): Promise<TrainingPlan | undefined> {
    const [updated] = await db
      .update(trainingPlans)
      .set({ name })
      .where(and(eq(trainingPlans.id, planId), eq(trainingPlans.userId, userId)))
      .returning();
    return updated;
  }

  async updateTrainingPlanGoal(
    planId: string,
    goal: string | null,
    userId: string,
  ): Promise<TrainingPlan | undefined> {
    const [updated] = await db
      .update(trainingPlans)
      .set({ goal })
      .where(and(eq(trainingPlans.id, planId), eq(trainingPlans.userId, userId)))
      .returning();
    return updated;
  }

  /**
   * Archive a plan effective `retiredOn`, or restore it with `null`.
   *
   * The caller is responsible for clamping the date — see the route, which pins
   * it to the athlete's own today so a back-dated retirement can't strand days
   * the sweep already flipped to `missed`: those would keep rendering red on the
   * timeline while the adherence denominator quietly ignored them, and
   * `missed → planned` is forbidden, so there would be no way back.
   */
  async setPlanRetirement(
    planId: string,
    retiredOn: string | null,
    userId: string,
  ): Promise<TrainingPlan | undefined> {
    const [updated] = await db
      .update(trainingPlans)
      .set({ retiredOn })
      .where(and(eq(trainingPlans.id, planId), eq(trainingPlans.userId, userId)))
      .returning();
    return updated;
  }

  /**
   * Retire several plans at once, for the supersede-on-generate flow.
   *
   * `retired_on IS NULL` in the WHERE makes this idempotent and stops it stomping
   * an EARLIER manual retirement with a later date — that would resurrect days the
   * athlete had already written off. Ownership is re-checked in SQL rather than
   * trusted from the caller because the plan ids arrive on a durable queue payload
   * that was validated at the route, possibly by a previous deploy.
   */
  async retirePlans(
    planIds: readonly string[],
    userId: string,
    retiredOn: string,
    tx?: DbExecutor,
  ): Promise<string[]> {
    if (planIds.length === 0) return [];
    const updated = await (tx ?? db)
      .update(trainingPlans)
      .set({ retiredOn })
      .where(
        and(
          inArray(trainingPlans.id, [...planIds]),
          eq(trainingPlans.userId, userId),
          isNull(trainingPlans.retiredOn),
        ),
      )
      .returning({ id: trainingPlans.id });
    return updated.map((row) => row.id);
  }

  /**
   * Live plans whose scheduled window intersects [start, end], excluding one plan
   * by id. Used to refuse a restore that would put two live plans over the same
   * days — the exact state the lifecycle column exists to prevent, which restoring
   * would otherwise recreate by construction.
   */
  async findOverlappingActivePlans(
    userId: string,
    start: string,
    end: string,
    excludePlanId?: string,
  ): Promise<TrainingPlan[]> {
    return await db
      .select()
      .from(trainingPlans)
      .where(
        and(
          eq(trainingPlans.userId, userId),
          isNull(trainingPlans.retiredOn),
          isNotNull(trainingPlans.startDate),
          isNotNull(trainingPlans.endDate),
          lte(trainingPlans.startDate, end),
          gte(trainingPlans.endDate, start),
          ...(excludePlanId ? [ne(trainingPlans.id, excludePlanId)] : []),
        ),
      );
  }

  async deleteTrainingPlan(planId: string, userId: string): Promise<boolean> {
    const [plan] = await db
      .select()
      .from(trainingPlans)
      .where(and(eq(trainingPlans.id, planId), eq(trainingPlans.userId, userId)));

    if (!plan) return false;

    return await db.transaction(async (tx) => {
      await tx.delete(planDays).where(eq(planDays.planId, planId));
      const result = await tx.delete(trainingPlans).where(eq(trainingPlans.id, planId));
      return result.rowCount !== null && result.rowCount > 0;
    });
  }

  async createPlanDays(days: InsertPlanDay[], tx?: DbExecutor): Promise<PlanDay[]> {
    if (days.length === 0) return [];
    const executor = tx ?? db;
    return await executor.insert(planDays).values(days).returning();
  }

  /**
   * Returns how many plan_days the plan schedules per week, on average. Used
   * to sanity-check a user's weeklyGoal against their plan density (S4) —
   * a 2-day plan + goal of 7 will show 0% completion unless the user logs
   * extra ad-hoc workouts, so the UI surfaces a gentle warning.
   *
   * The average is returned as a REAL number, not rounded up. It used to be
   * `Math.ceil`, which suppressed the very warning this exists to raise: a plan
   * of 10 days over 4 weeks schedules 2.5 per week, reported 3, so a goal of 3
   * compared 3 > 3 and stayed silent — while the athlete sat at 2.5/3 and
   * watched their completion rate cap out at 83% with no explanation (audit
   * L13). Rounding up is only ever safe for a floor, and this value is a
   * ceiling on what the plan can deliver.
   *
   * Two decimal places, because the raw quotient is a float: 10/3 stored as
   * 3.3333333333333335 would make an exactly-matched goal read as exceeding
   * the plan on representation alone.
   */
  async getPlanWeeklyDensity(planId: string): Promise<number | undefined> {
    // Start FROM training_plans + LEFT JOIN plan_days so a plan with zero
    // days still returns a row (count = 0, density = 0) instead of the
    // "plan not found" shape. Codex flagged this: a user who deletes every
    // plan_day on an active plan would otherwise look like "no active plan"
    // and the weeklyGoalExceedsPlan hint would silently go false.
    const [row] = await db
      .select({
        planDayCount: sql<number>`cast(count(${planDays.id}) as int)`,
        totalWeeks: trainingPlans.totalWeeks,
      })
      .from(trainingPlans)
      .leftJoin(planDays, eq(planDays.planId, trainingPlans.id))
      .where(eq(trainingPlans.id, planId))
      .groupBy(trainingPlans.totalWeeks);

    // totalWeeks is nullable on the schema; bail if the plan never had one set.
    const totalWeeks = row?.totalWeeks ?? 0;
    if (totalWeeks <= 0) return undefined;
    return Math.round((row.planDayCount / totalWeeks) * 100) / 100;
  }

  /** Class-method wrapper for the standalone syncPlanDayStatusFromWorkouts (S6). */
  syncPlanDayStatusFromWorkouts(planDayId: string, userId: string, tx?: DbExecutor): Promise<void> {
    return syncPlanDayStatusFromWorkouts(planDayId, userId, tx);
  }

  async updatePlanDay(
    dayId: string,
    updates: UpdatePlanDay,
    userId: string,
    tx?: DbExecutor,
  ): Promise<PlanDay | undefined> {
    const executor = tx ?? db;
    const day = await this.getPlanDay(dayId, userId, executor);
    if (!day) return undefined;

    const [updatedDay] = await executor
      .update(planDays)
      .set(updates)
      .where(eq(planDays.id, dayId))
      .returning();
    return updatedDay;
  }

  async getPlanDay(
    dayId: string,
    userId: string,
    tx?: DbExecutor,
  ): Promise<PlanDay | undefined> {
    const executor = tx ?? db;
    // Uses the relational query API: fetch the plan day and filter via its
    // parent plan's owner in-memory. Equivalent to an inner join with an auth
    // guard on training_plans.user_id.
    const day = await executor.query.planDays.findFirst({
      where: eq(planDays.id, dayId),
      with: {
        plan: {
          columns: { userId: true },
        },
      },
    });
    if (!day || day.plan?.userId !== userId) return undefined;
    // Strip the joined relation before returning to preserve the original shape.
    const { plan: _plan, ...planDay } = day;
    return planDay;
  }

  // ⚡ Bolt Performance Optimization: batched sibling of getPlanDay(), for
  // callers that resolve several plan days at once (e.g. enrichProposedChanges
  // enriching every day an AI plan-adjustment proposal touches). A single
  // inner join against training_plans expresses ownership directly instead of
  // one getPlanDay() round trip per id, dropping N sequential reads to 1.
  async getPlanDaysByIds(dayIds: string[], userId: string): Promise<PlanDay[]> {
    if (dayIds.length === 0) return [];
    const rows = await db
      .select({ day: planDays })
      .from(planDays)
      .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
      .where(and(inArray(planDays.id, dayIds), eq(trainingPlans.userId, userId)));
    return rows.map((r) => r.day);
  }

  async deletePlanDay(dayId: string, userId: string): Promise<boolean> {
    const existingDay = await this.getPlanDay(dayId, userId);
    if (!existingDay) return false;

    const result = await db.delete(planDays).where(eq(planDays.id, dayId));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async schedulePlan(planId: string, startDate: string, userId: string): Promise<boolean> {
    const plan = await this.getTrainingPlan(planId, userId);
    if (!plan) return false;

    const dayNameToOffset: Record<string, number> = {
      monday: 0,
      tuesday: 1,
      wednesday: 2,
      thursday: 3,
      friday: 4,
      saturday: 5,
      sunday: 6,
    };
    const normalizeDayName = (raw: string | null | undefined): string =>
      (raw ?? "").trim().toLowerCase();

    // Pure calendar math: the previous form parsed the ISO date as UTC midnight
    // and then walked it with local-time accessors (getDay/setDate), so the
    // whole schedule shifted by a day whenever the server process ran in a
    // non-UTC zone. addDaysToISODate never leaves date-only space.
    const startDayOfWeek = new Date(`${startDate}T00:00:00Z`).getUTCDay();
    const mondayOffset = startDayOfWeek === 0 ? -6 : 1 - startDayOfWeek;
    const weekOneMonday = addDaysToISODate(startDate, mondayOffset);

    if (plan.days.length === 0) return true;

    // ⚡ Perf: Replaced mapped array and Math.min spread with a single O(N) linear scan
    // to avoid intermediate array allocation and prevent "Maximum call stack size exceeded" errors.
    let minWeek = Infinity;
    for (const day of plan.days) {
      const week = day.weekNumber || 1;
      if (week < minWeek) {
        minWeek = week;
      }
    }

    // Whether a rescheduled day lands in the future is judged on the athlete's
    // calendar, like every other "today" in this class.
    const today = await this.resolveUserToday(userId);

    const dateUpdates: { id: string; scheduledDate: string; resetStatus: boolean }[] = [];
    for (const day of plan.days) {
      const normalizedWeek = (day.weekNumber || 1) - minWeek + 1;
      const weekOffset = (normalizedWeek - 1) * 7;
      const normalized = normalizeDayName(day.dayName);
      const dayOffset = normalized in dayNameToOffset ? dayNameToOffset[normalized] : 0;
      if (!(normalized in dayNameToOffset)) {
        logger.warn(
          { dayId: day.id, rawDayName: day.dayName, planId },
          "Unrecognized plan-day dayName; scheduling as Monday",
        );
      }
      const dateStr = addDaysToISODate(weekOneMonday, weekOffset + dayOffset);
      // Only reset status when the day actually moves to a new date. Without
      // this guard, calling schedulePlan with the same startDate (or any
      // reschedule that happens to leave a specific day on its existing
      // calendar slot) would silently revert that day's explicit "skipped"
      // choice back to "planned". We reset both "missed" (system-assigned)
      // and "skipped" (user choice) because a genuine date change semantically
      // gives the day a fresh planned status (S18).
      const dateChanged = dateStr !== day.scheduledDate;
      dateUpdates.push({
        id: day.id,
        scheduledDate: dateStr,
        resetStatus:
          dateChanged &&
          (day.status === "missed" || day.status === "skipped") &&
          dateStr >= today,
      });
    }

    if (dateUpdates.length === 0) return true;

    // Derive plan-level start/end dates from the scheduled days
    const scheduledDates = dateUpdates.map((u) => u.scheduledDate);
    // ⚡ Bolt Performance Optimization:
    // Replaced localeCompare with standard string comparison for YYYY-MM-DD dates.
    // localeCompare introduces significant unnecessary overhead when sorting large arrays.
    scheduledDates.sort((a, b) => {
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    });
    const planStartDate = scheduledDates[0];
    const planEndDate = scheduledDates.at(-1) ?? scheduledDates[0];

    return await db.transaction(async (tx) => {
      // Secure batch update using idiomatic Drizzle query builder and a CASE statement
      const caseChunks = [];
      caseChunks.push(sql`CASE ${planDays.id} `);
      for (const u of dateUpdates) {
        caseChunks.push(sql`WHEN ${u.id} THEN ${u.scheduledDate}::date `);
      }
      caseChunks.push(sql`END`);

      const caseSql = sql.join(caseChunks, sql``);
      const updateIds = dateUpdates.map((u) => u.id);

      // Perform a single batch update
      await tx
        .update(planDays)
        .set({ scheduledDate: caseSql })
        .where(inArray(planDays.id, updateIds));

      const resetUpdateIds = dateUpdates.filter((u) => u.resetStatus).map((u) => u.id);
      if (resetUpdateIds.length > 0) {
        await tx
          .update(planDays)
          .set({ status: "planned" })
          .where(inArray(planDays.id, resetUpdateIds));
      }

      // Update plan-level start/end dates
      await tx
        .update(trainingPlans)
        .set({ startDate: planStartDate, endDate: planEndDate })
        .where(eq(trainingPlans.id, planId));

      return true;
    });
  }

  async findMatchingPlanDay(planId: string, date: string): Promise<PlanDay | undefined> {
    const [match] = await db
      .select()
      .from(planDays)
      .where(
        and(
          eq(planDays.planId, planId),
          eq(planDays.scheduledDate, date),
          eq(planDays.status, "planned"),
        ),
      )
      .limit(1);

    return match;
  }

  async getActivePlan(userId: string): Promise<TrainingPlan | undefined> {
    // Which plan is active "today" is a question about the athlete's calendar:
    // a UTC date makes a plan starting tomorrow go live during tonight, and
    // drops a plan that ends today an evening early.
    return this.getPlanForDate(userId, await this.resolveUserToday(userId));
  }

  /** The athlete's own calendar date, degrading to UTC for an unusable zone. */
  private async resolveUserToday(userId: string): Promise<string> {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { userTimezone: true },
    });
    return getLocalDateStrSafe(new Date(), user?.userTimezone);
  }

  async getPlanForDate(userId: string, date: string): Promise<TrainingPlan | undefined> {
    // Single query with priority-based ordering:
    //   0 = plan covering the date, 1 = most recently ended, 2 = next upcoming
    const [plan] = await db
      .select()
      .from(trainingPlans)
      .where(
        and(
          eq(trainingPlans.userId, userId),
          isNotNull(trainingPlans.startDate),
          isNotNull(trainingPlans.endDate),
          // A retired plan still answers for the stretch it actually ran, and is
          // invisible from its cutoff onward. Scoped here rather than at each call
          // site because this method is the single choke point every consumer of
          // "the active plan" goes through — AI coaching context, nutrition phase,
          // the weekly-goal hint, and resolveActivePlanLinks, which attributes
          // newly logged workouts and marks plan days completed.
          planLiveForDate(date),
        ),
      )
      .orderBy(
        sql`CASE
          WHEN ${trainingPlans.startDate} <= ${date} AND ${trainingPlans.endDate} >= ${date} THEN 0
          WHEN ${trainingPlans.endDate} < ${date} THEN 1
          WHEN ${trainingPlans.startDate} > ${date} THEN 2
        END`,
        sql`CASE WHEN ${trainingPlans.startDate} > ${date} THEN ${trainingPlans.startDate} END ASC NULLS LAST`,
        // Most recently STARTED block wins an overlap, with end date only as a
        // final tiebreak. It used to be end-date-first, which resolved an overlap
        // by longevity: an athlete who started a short 4-week block while a
        // 12-week plan still had 6 weeks to run kept getting the old plan back,
        // because it happened to finish later. Retirement is opt-in and can't
        // help here — every plan predating this column has retired_on NULL, and
        // imports, sample plans and /schedule can still create overlaps without
        // ever going through the supersede flow. Ordering by start date fixes
        // that whole population with no backfill.
        sql`${trainingPlans.startDate} DESC`,
        sql`${trainingPlans.endDate} DESC`,
      )
      .limit(1);

    return plan;
  }

  /**
   * Flip past planned days to `missed`. Judged against each athlete's OWN
   * calendar date: a single UTC comparison persisted `missed` onto the day a
   * California athlete was still training, and unlike the timeline's render-time
   * status this is a WRITE — it only unwinds if the athlete later logs against
   * that plan day with an explicit planDayId.
   *
   * Grouped by stored timezone, so the sweep costs one statement per distinct
   * zone (tens at most, and only ever run at boot or once daily). The local date
   * is computed in JS rather than with `AT TIME ZONE u.user_timezone`: that form
   * raises `invalid value for parameter TimeZone` on a single unrecognised name
   * and would abort the sweep for every other athlete with it.
   *
   * Days inside a declared absence are left alone. An athlete who has written
   * "injured, 12–19 Aug" on their timeline has already accounted for that week;
   * writing `missed` across it is the app telling them they failed at something
   * they told us about first. Because those days keep their `planned` status,
   * the decision stays reversible — delete the annotation and the next sweep
   * marks them missed as it always would have.
   */
  async markMissedPlanDays(): Promise<number> {
    const zones = await db.selectDistinct({ tz: users.userTimezone }).from(users);

    let total = 0;
    for (const { tz } of zones) {
      const today = getLocalDateStrSafe(new Date(), tz);
      const zonePlanIds = db
        .select({ id: trainingPlans.id })
        .from(trainingPlans)
        .innerJoin(users, eq(users.id, trainingPlans.userId))
        .where(eq(users.userTimezone, tz));

      const result = await db
        .update(planDays)
        .set({ status: "missed" })
        .where(
          and(
            eq(planDays.status, "planned"),
            lt(planDays.scheduledDate, today),
            inArray(planDays.planId, zonePlanIds),
            // Days from a retired plan's cutoff onward are training the athlete
            // deliberately walked away from — writing `missed` across them is the
            // app telling them they failed at something they already decided not
            // to do, and because `missed → planned` is FORBIDDEN (see enums.ts)
            // the damage would be permanent. Same reasoning as the declared-absence
            // guard below. Both guards are built in planRetirement.ts /
            // absenceGuard.ts so the SQL-rendering test asserts these exact
            // predicates instead of copies of them.
            missedSweepRetirementGuard(db),
            noAbsenceDeclaredForPlanDay(db),
          ),
        )
        .returning({ id: planDays.id });
      total += result.length;
    }
    return total;
  }

  /**
   * Fail plans left in `pending`/`generating` past `olderThanMs` (S2). The
   * pg-boss plan-generation job is NO_RETRY and isn't resumed after a crash, so
   * a worker that dies mid-job strands the plan in a perpetual loading state the
   * user can't escape. `executePlanGeneration`'s catch always flips to `failed`,
   * so the only way a row stays in flight is a crash — this sweep cleans those
   * up on startup. The threshold must comfortably exceed real generation time so
   * a genuinely in-flight job on another instance is never failed.
   */
  async failStalePlanGenerations(olderThanMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const result = await db
      .update(trainingPlans)
      .set({
        generationStatus: "failed",
        generationError:
          "Plan generation was interrupted (likely a server restart). Please try again.",
      })
      .where(
        and(
          inArray(trainingPlans.generationStatus, ["pending", "generating"]),
          lt(trainingPlans.generationStartedAt, cutoff),
        ),
      )
      .returning({ id: trainingPlans.id });
    return result.length;
  }
}
