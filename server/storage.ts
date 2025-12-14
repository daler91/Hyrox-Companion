import {
  users,
  trainingPlans,
  planDays,
  workoutLogs,
  chatMessages,
  type User,
  type UpsertUser,
  type TrainingPlan,
  type InsertTrainingPlan,
  type PlanDay,
  type InsertPlanDay,
  type UpdatePlanDay,
  type TrainingPlanWithDays,
  type WorkoutLog,
  type InsertWorkoutLog,
  type UpdateWorkoutLog,
  type TimelineEntry,
  type UpdateUserPreferences,
  type ChatMessage,
  type InsertChatMessage,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, isNull, sql } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserPreferences(userId: string, preferences: UpdateUserPreferences): Promise<User | undefined>;

  createTrainingPlan(plan: InsertTrainingPlan): Promise<TrainingPlan>;
  listTrainingPlans(userId: string): Promise<TrainingPlan[]>;
  getTrainingPlan(planId: string, userId: string): Promise<TrainingPlanWithDays | undefined>;
  deleteTrainingPlan(planId: string, userId: string): Promise<boolean>;

  createPlanDays(days: InsertPlanDay[]): Promise<PlanDay[]>;
  updatePlanDay(dayId: string, updates: UpdatePlanDay, userId: string): Promise<PlanDay | undefined>;
  getPlanDay(dayId: string, userId: string): Promise<PlanDay | undefined>;

  createWorkoutLog(log: InsertWorkoutLog & { userId: string }): Promise<WorkoutLog>;
  listWorkoutLogs(userId: string): Promise<WorkoutLog[]>;
  getWorkoutLog(logId: string, userId: string): Promise<WorkoutLog | undefined>;
  updateWorkoutLog(logId: string, updates: UpdateWorkoutLog, userId: string): Promise<WorkoutLog | undefined>;
  deleteWorkoutLog(logId: string, userId: string): Promise<boolean>;

  getTimeline(userId: string, planId?: string): Promise<TimelineEntry[]>;

  getChatMessages(userId: string): Promise<ChatMessage[]>;
  saveChatMessage(message: InsertChatMessage): Promise<ChatMessage>;
  clearChatHistory(userId: string): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async updateUserPreferences(userId: string, preferences: UpdateUserPreferences): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({
        ...preferences,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

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

  async deleteTrainingPlan(planId: string, userId: string): Promise<boolean> {
    const [plan] = await db
      .select()
      .from(trainingPlans)
      .where(and(eq(trainingPlans.id, planId), eq(trainingPlans.userId, userId)));
    
    if (!plan) return false;
    
    await db.delete(planDays).where(eq(planDays.planId, planId));
    const result = await db.delete(trainingPlans).where(eq(trainingPlans.id, planId));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async createPlanDays(days: InsertPlanDay[]): Promise<PlanDay[]> {
    if (days.length === 0) return [];
    return await db.insert(planDays).values(days).returning();
  }

  async updatePlanDay(dayId: string, updates: UpdatePlanDay, userId: string): Promise<PlanDay | undefined> {
    const day = await this.getPlanDay(dayId, userId);
    if (!day) return undefined;
    
    const [updatedDay] = await db
      .update(planDays)
      .set(updates)
      .where(eq(planDays.id, dayId))
      .returning();
    return updatedDay;
  }

  async getPlanDay(dayId: string, userId: string): Promise<PlanDay | undefined> {
    const result = await db
      .select({ planDay: planDays })
      .from(planDays)
      .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
      .where(and(eq(planDays.id, dayId), eq(trainingPlans.userId, userId)));
    
    return result[0]?.planDay;
  }

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

  async getTimeline(userId: string, planId?: string): Promise<TimelineEntry[]> {
    const entries: TimelineEntry[] = [];
    const today = new Date().toISOString().split("T")[0];

    const planDayConditions = planId 
      ? and(eq(trainingPlans.userId, userId), eq(planDays.planId, planId))
      : eq(trainingPlans.userId, userId);

    const scheduledDaysResult = await db
      .select({ planDay: planDays })
      .from(planDays)
      .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
      .where(planDayConditions);

    const scheduledDays = scheduledDaysResult
      .map(r => r.planDay)
      .filter(d => d.scheduledDate);

    const userWorkouts = await db
      .select()
      .from(workoutLogs)
      .where(eq(workoutLogs.userId, userId));

    for (const day of scheduledDays) {
      if (day.scheduledDate) {
        const linkedLog = userWorkouts.find((log) => log.planDayId === day.id);

        if (linkedLog) {
          entries.push({
            id: `log-${linkedLog.id}`,
            date: linkedLog.date,
            type: "logged",
            status: "completed",
            focus: linkedLog.focus,
            mainWorkout: linkedLog.mainWorkout,
            accessory: linkedLog.accessory,
            notes: linkedLog.notes,
            duration: linkedLog.duration,
            rpe: linkedLog.rpe,
            planDayId: day.id,
            workoutLogId: linkedLog.id,
            weekNumber: day.weekNumber,
            dayName: day.dayName,
          });
        } else {
          const status = day.status === "skipped" ? "skipped" :
            day.status === "completed" ? "completed" :
            day.status === "missed" ? "missed" :
            day.scheduledDate < today ? "missed" : "planned";

          entries.push({
            id: `plan-${day.id}`,
            date: day.scheduledDate,
            type: "planned",
            status: status as any,
            focus: day.focus,
            mainWorkout: day.mainWorkout,
            accessory: day.accessory,
            notes: day.notes,
            planDayId: day.id,
            weekNumber: day.weekNumber,
            dayName: day.dayName,
          });
        }
      }
    }

    const standaloneWorkouts = userWorkouts.filter((log) => !log.planDayId);

    for (const log of standaloneWorkouts) {
      entries.push({
        id: `log-${log.id}`,
        date: log.date,
        type: "logged",
        status: "completed",
        focus: log.focus,
        mainWorkout: log.mainWorkout,
        accessory: log.accessory,
        notes: log.notes,
        duration: log.duration,
        rpe: log.rpe,
        workoutLogId: log.id,
      });
    }

    return entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  async getChatMessages(userId: string): Promise<ChatMessage[]> {
    return await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.userId, userId))
      .orderBy(chatMessages.timestamp);
  }

  async saveChatMessage(message: InsertChatMessage): Promise<ChatMessage> {
    const [chatMessage] = await db
      .insert(chatMessages)
      .values(message)
      .returning();
    return chatMessage;
  }

  async clearChatHistory(userId: string): Promise<boolean> {
    const result = await db
      .delete(chatMessages)
      .where(eq(chatMessages.userId, userId));
    return true;
  }
}

export const storage = new DatabaseStorage();
