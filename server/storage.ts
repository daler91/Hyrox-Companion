import {
  type User,
  type InsertUser,
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
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  createTrainingPlan(plan: InsertTrainingPlan): Promise<TrainingPlan>;
  listTrainingPlans(): Promise<TrainingPlan[]>;
  getTrainingPlan(planId: string): Promise<TrainingPlanWithDays | undefined>;
  deleteTrainingPlan(planId: string): Promise<boolean>;

  createPlanDays(days: InsertPlanDay[]): Promise<PlanDay[]>;
  updatePlanDay(dayId: string, updates: UpdatePlanDay): Promise<PlanDay | undefined>;
  getPlanDay(dayId: string): Promise<PlanDay | undefined>;

  createWorkoutLog(log: InsertWorkoutLog): Promise<WorkoutLog>;
  listWorkoutLogs(): Promise<WorkoutLog[]>;
  getWorkoutLog(logId: string): Promise<WorkoutLog | undefined>;
  updateWorkoutLog(logId: string, updates: UpdateWorkoutLog): Promise<WorkoutLog | undefined>;
  deleteWorkoutLog(logId: string): Promise<boolean>;

  getTimeline(planId?: string): Promise<TimelineEntry[]>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private trainingPlans: Map<string, TrainingPlan>;
  private planDays: Map<string, PlanDay>;
  private workoutLogs: Map<string, WorkoutLog>;

  constructor() {
    this.users = new Map();
    this.trainingPlans = new Map();
    this.planDays = new Map();
    this.workoutLogs = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async createTrainingPlan(plan: InsertTrainingPlan): Promise<TrainingPlan> {
    const id = randomUUID();
    const trainingPlan: TrainingPlan = {
      id,
      name: plan.name,
      sourceFileName: plan.sourceFileName ?? null,
      totalWeeks: plan.totalWeeks,
    };
    this.trainingPlans.set(id, trainingPlan);
    return trainingPlan;
  }

  async listTrainingPlans(): Promise<TrainingPlan[]> {
    return Array.from(this.trainingPlans.values());
  }

  async getTrainingPlan(planId: string): Promise<TrainingPlanWithDays | undefined> {
    const plan = this.trainingPlans.get(planId);
    if (!plan) return undefined;

    const dayOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const days = Array.from(this.planDays.values())
      .filter((day) => day.planId === planId)
      .sort((a, b) => {
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

  async deleteTrainingPlan(planId: string): Promise<boolean> {
    const plan = this.trainingPlans.get(planId);
    if (!plan) return false;

    const dayEntries = Array.from(this.planDays.entries());
    for (const [dayId, day] of dayEntries) {
      if (day.planId === planId) {
        this.planDays.delete(dayId);
      }
    }
    this.trainingPlans.delete(planId);
    return true;
  }

  async createPlanDays(days: InsertPlanDay[]): Promise<PlanDay[]> {
    const createdDays: PlanDay[] = [];
    for (const day of days) {
      const id = randomUUID();
      const planDay: PlanDay = {
        id,
        planId: day.planId,
        weekNumber: day.weekNumber,
        dayName: day.dayName,
        focus: day.focus,
        mainWorkout: day.mainWorkout,
        accessory: day.accessory ?? null,
        notes: day.notes ?? null,
        scheduledDate: day.scheduledDate ?? null,
        status: day.status ?? "planned",
      };
      this.planDays.set(id, planDay);
      createdDays.push(planDay);
    }
    return createdDays;
  }

  async updatePlanDay(dayId: string, updates: UpdatePlanDay): Promise<PlanDay | undefined> {
    const day = this.planDays.get(dayId);
    if (!day) return undefined;

    const updatedDay: PlanDay = { ...day, ...updates };
    this.planDays.set(dayId, updatedDay);
    return updatedDay;
  }

  async getPlanDay(dayId: string): Promise<PlanDay | undefined> {
    return this.planDays.get(dayId);
  }

  async createWorkoutLog(log: InsertWorkoutLog): Promise<WorkoutLog> {
    const id = randomUUID();
    const workoutLog: WorkoutLog = {
      id,
      date: log.date,
      focus: log.focus,
      mainWorkout: log.mainWorkout,
      accessory: log.accessory ?? null,
      notes: log.notes ?? null,
      duration: log.duration ?? null,
      rpe: log.rpe ?? null,
      planDayId: log.planDayId ?? null,
    };
    this.workoutLogs.set(id, workoutLog);

    if (log.planDayId) {
      const planDay = this.planDays.get(log.planDayId);
      if (planDay) {
        this.planDays.set(log.planDayId, { ...planDay, status: "completed" });
      }
    }

    return workoutLog;
  }

  async listWorkoutLogs(): Promise<WorkoutLog[]> {
    return Array.from(this.workoutLogs.values()).sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }

  async getWorkoutLog(logId: string): Promise<WorkoutLog | undefined> {
    return this.workoutLogs.get(logId);
  }

  async updateWorkoutLog(logId: string, updates: UpdateWorkoutLog): Promise<WorkoutLog | undefined> {
    const log = this.workoutLogs.get(logId);
    if (!log) return undefined;

    const updatedLog: WorkoutLog = { ...log, ...updates };
    this.workoutLogs.set(logId, updatedLog);
    return updatedLog;
  }

  async deleteWorkoutLog(logId: string): Promise<boolean> {
    return this.workoutLogs.delete(logId);
  }

  async getTimeline(planId?: string): Promise<TimelineEntry[]> {
    const entries: TimelineEntry[] = [];
    const today = new Date().toISOString().split("T")[0];

    const planDaysArray = Array.from(this.planDays.values())
      .filter((day) => !planId || day.planId === planId);

    for (const day of planDaysArray) {
      if (day.scheduledDate) {
        const linkedLog = Array.from(this.workoutLogs.values()).find(
          (log) => log.planDayId === day.id
        );

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

    const standaloneWorkouts = Array.from(this.workoutLogs.values())
      .filter((log) => !log.planDayId);

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
}

export const storage = new MemStorage();
