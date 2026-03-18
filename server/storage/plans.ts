import {
  trainingPlans,
  planDays,
  type TrainingPlan,
  type InsertTrainingPlan,
  type PlanDay,
  type InsertPlanDay,
  type UpdatePlanDay,
  type TrainingPlanWithDays,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { toDateStr } from "../types";

export class PlanStorage {
  async createTrainingPlan(plan: InsertTrainingPlan): Promise<TrainingPlan> {
    const [trainingPlan] = await db
      .insert(trainingPlans)
      .values(plan)
      .returning();
    return trainingPlan;
  }

  async listTrainingPlans(userId: string): Promise<TrainingPlan[]> {
    return await db
      .select()
      .from(trainingPlans)
      .where(eq(trainingPlans.userId, userId));
  }

  async getTrainingPlan(planId: string, userId: string): Promise<TrainingPlanWithDays | undefined> {
    const [plan] = await db
      .select()
      .from(trainingPlans)
      .where(and(eq(trainingPlans.id, planId), eq(trainingPlans.userId, userId)));
    
    if (!plan) return undefined;

    const days = await db
      .select()
      .from(planDays)
      .where(eq(planDays.planId, planId));

    const dayOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    days.sort((a, b) => {
      if (a.weekNumber !== b.weekNumber) return a.weekNumber - b.weekNumber;
      const aIndex = dayOrder.indexOf(a.dayName);
      const bIndex = dayOrder.indexOf(b.dayName);
      if (aIndex === -1 && bIndex === -1) return 0;
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });

    return { ...plan, days };
  }

  async renameTrainingPlan(planId: string, name: string, userId: string): Promise<TrainingPlan | undefined> {
    const [updated] = await db
      .update(trainingPlans)
      .set({ name })
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
      await tx.delete(planDays).where(and(eq(planDays.planId, planId), eq(planDays.userId, userId)));
      const result = await tx.delete(trainingPlans).where(eq(trainingPlans.id, planId));
      return result.rowCount !== null && result.rowCount > 0;
    });
  }

  async createPlanDays(days: InsertPlanDay[]): Promise<PlanDay[]> {
    if (days.length === 0) return [];
    return await db.insert(planDays).values(days).returning();
  }

  async updatePlanDay(dayId: string, updates: UpdatePlanDay, userId: string): Promise<PlanDay | undefined> {
    const [updatedDay] = await db
      .update(planDays)
      .set(updates)
      .where(and(eq(planDays.id, dayId), eq(planDays.userId, userId)))
      .returning();
    return updatedDay;
  }

  async getPlanDay(dayId: string, userId: string): Promise<PlanDay | undefined> {
    const [result] = await db
      .select()
      .from(planDays)
      .where(and(eq(planDays.id, dayId), eq(planDays.userId, userId)));
    
    return result;
  }

  async deletePlanDay(dayId: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(planDays)
      .where(and(eq(planDays.id, dayId), eq(planDays.userId, userId)));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async schedulePlan(planId: string, startDate: string, userId: string): Promise<boolean> {
    const plan = await this.getTrainingPlan(planId, userId);
    if (!plan) return false;

    const dayNameToOffset: Record<string, number> = {
      "Monday": 0,
      "Tuesday": 1,
      "Wednesday": 2,
      "Thursday": 3,
      "Friday": 4,
      "Saturday": 5,
      "Sunday": 6,
    };

    const start = new Date(startDate);
    const startDayOfWeek = start.getDay();
    const mondayOffset = startDayOfWeek === 0 ? -6 : 1 - startDayOfWeek;
    const weekOneMonday = new Date(start);
    weekOneMonday.setDate(start.getDate() + mondayOffset);

    if (plan.days.length === 0) return true;
    const weekNumbers = plan.days.map(d => d.weekNumber || 1);
    const minWeek = Math.min(...weekNumbers);

    const today = toDateStr();

    const dateUpdates: { id: string; scheduledDate: string; resetStatus: boolean }[] = [];
    for (const day of plan.days) {
      const normalizedWeek = (day.weekNumber || 1) - minWeek + 1;
      const weekOffset = (normalizedWeek - 1) * 7;
      const dayOffset = dayNameToOffset[day.dayName || "Monday"] || 0;
      const scheduledDate = new Date(weekOneMonday);
      scheduledDate.setDate(weekOneMonday.getDate() + weekOffset + dayOffset);
      const dateStr = toDateStr(scheduledDate);
      dateUpdates.push({
        id: day.id,
        scheduledDate: dateStr,
        resetStatus: day.status === 'missed' && dateStr >= today,
      });
    }

    if (dateUpdates.length === 0) return true;

    return await db.transaction(async (tx) => {
      // Secure batch update using individual parameterized queries within the transaction
      await Promise.all(
        dateUpdates.map(u =>
          tx.update(planDays)
            .set({ scheduledDate: u.scheduledDate })
            .where(and(eq(planDays.id, u.id), eq(planDays.userId, userId)))
        )
      );

      const resetUpdateIds = dateUpdates.filter(u => u.resetStatus).map(u => u.id);
      if (resetUpdateIds.length > 0) {
        await tx.update(planDays).set({ status: 'planned' }).where(and(inArray(planDays.id, resetUpdateIds), eq(planDays.userId, userId)));
      }

      return true;
    });
  }

  async markMissedPlanDays(): Promise<number> {
    const today = toDateStr();
    const result = await db
      .update(planDays)
      .set({ status: 'missed' })
      .where(
        and(
          eq(planDays.status, 'planned'),
          sql`${planDays.scheduledDate} < ${today}`
        )
      )
      .returning({ id: planDays.id });
    return result.length;
  }
}
