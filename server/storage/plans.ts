import {
  type InsertPlanDay,
  type InsertTrainingPlan,
  type PlanDay,
  planDays,
  type TrainingPlan,
  trainingPlans,
  type TrainingPlanWithDays,
  type UpdatePlanDay,
} from "@shared/schema";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db, type DbExecutor } from "../db";
import { logger } from "../logger";
import { toDateStr } from "../types";
import { syncPlanDayStatusFromWorkouts } from "./planDayStatus";

// Re-export for callers that already reach for it via PlanStorage's neighbours.
export { syncPlanDayStatusFromWorkouts } from "./planDayStatus";

export class PlanStorage {
  async createTrainingPlan(plan: InsertTrainingPlan): Promise<TrainingPlan> {
    const [trainingPlan] = await db.insert(trainingPlans).values(plan).returning();
    return trainingPlan;
  }

  async listTrainingPlans(userId: string): Promise<TrainingPlan[]> {
    return await db.select().from(trainingPlans).where(eq(trainingPlans.userId, userId));
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

  async createPlanDays(days: InsertPlanDay[]): Promise<PlanDay[]> {
    if (days.length === 0) return [];
    return await db.insert(planDays).values(days).returning();
  }

  /**
   * Returns how many plan_days the plan schedules per week, on average. Used
   * to sanity-check a user's weeklyGoal against their plan density (S4) —
   * a 2-day plan + goal of 7 will show 0% completion unless the user logs
   * extra ad-hoc workouts, so the UI surfaces a gentle warning.
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
    return Math.ceil(row.planDayCount / totalWeeks);
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

    const start = new Date(startDate);
    const startDayOfWeek = start.getDay();
    const mondayOffset = startDayOfWeek === 0 ? -6 : 1 - startDayOfWeek;
    const weekOneMonday = new Date(start);
    weekOneMonday.setDate(start.getDate() + mondayOffset);

    if (plan.days.length === 0) return true;
    const weekNumbers = plan.days.map((d) => d.weekNumber || 1);
    const minWeek = Math.min(...weekNumbers);

    const today = toDateStr();

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
      const scheduledDate = new Date(weekOneMonday);
      scheduledDate.setDate(weekOneMonday.getDate() + weekOffset + dayOffset);
      const dateStr = toDateStr(scheduledDate);
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
        .set({ scheduledDate: caseSql as unknown as string })
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
    return this.getPlanForDate(userId, toDateStr());
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
        ),
      )
      .orderBy(
        sql`CASE
          WHEN ${trainingPlans.startDate} <= ${date} AND ${trainingPlans.endDate} >= ${date} THEN 0
          WHEN ${trainingPlans.endDate} < ${date} THEN 1
          WHEN ${trainingPlans.startDate} > ${date} THEN 2
        END`,
        sql`CASE WHEN ${trainingPlans.startDate} > ${date} THEN ${trainingPlans.startDate} END ASC NULLS LAST`,
        sql`${trainingPlans.endDate} DESC`,
      )
      .limit(1);

    return plan;
  }

  async markMissedPlanDays(): Promise<number> {
    const today = toDateStr();
    const result = await db
      .update(planDays)
      .set({ status: "missed" })
      .where(and(eq(planDays.status, "planned"), sql`${planDays.scheduledDate} < ${today}`))
      .returning({ id: planDays.id });
    return result.length;
  }
}
