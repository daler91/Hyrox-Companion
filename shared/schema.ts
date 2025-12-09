import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const trainingPlans = pgTable("training_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  sourceFileName: text("source_file_name"),
  totalWeeks: integer("total_weeks").notNull(),
});

export const insertTrainingPlanSchema = createInsertSchema(trainingPlans).omit({
  id: true,
});

export type InsertTrainingPlan = z.infer<typeof insertTrainingPlanSchema>;
export type TrainingPlan = typeof trainingPlans.$inferSelect;

export const planDays = pgTable("plan_days", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  planId: varchar("plan_id").notNull(),
  weekNumber: integer("week_number").notNull(),
  dayName: text("day_name").notNull(),
  focus: text("focus").notNull(),
  mainWorkout: text("main_workout").notNull(),
  accessory: text("accessory"),
  notes: text("notes"),
});

export const insertPlanDaySchema = createInsertSchema(planDays).omit({
  id: true,
});

export const updatePlanDaySchema = insertPlanDaySchema.partial().omit({
  planId: true,
});

export type InsertPlanDay = z.infer<typeof insertPlanDaySchema>;
export type UpdatePlanDay = z.infer<typeof updatePlanDaySchema>;
export type PlanDay = typeof planDays.$inferSelect;

export type TrainingPlanWithDays = TrainingPlan & {
  days: PlanDay[];
};
