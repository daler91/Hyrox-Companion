import {
  type User,
  type InsertUser,
  type TrainingPlan,
  type InsertTrainingPlan,
  type PlanDay,
  type InsertPlanDay,
  type UpdatePlanDay,
  type TrainingPlanWithDays,
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
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private trainingPlans: Map<string, TrainingPlan>;
  private planDays: Map<string, PlanDay>;

  constructor() {
    this.users = new Map();
    this.trainingPlans = new Map();
    this.planDays = new Map();
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
}

export const storage = new MemStorage();
