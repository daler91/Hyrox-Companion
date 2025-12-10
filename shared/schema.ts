import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, date, timestamp, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const workoutStatusEnum = ["planned", "completed", "missed", "skipped"] as const;
export type WorkoutStatus = (typeof workoutStatusEnum)[number];

// Session storage table for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User table for Replit Auth
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

export const trainingPlans = pgTable("training_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
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
  scheduledDate: date("scheduled_date"),
  status: text("status").default("planned"),
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

export const workoutLogs = pgTable("workout_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  date: date("date").notNull(),
  focus: text("focus").notNull(),
  mainWorkout: text("main_workout").notNull(),
  accessory: text("accessory"),
  notes: text("notes"),
  duration: integer("duration"),
  rpe: integer("rpe"),
  planDayId: varchar("plan_day_id"),
});

export const insertWorkoutLogSchema = createInsertSchema(workoutLogs).omit({
  id: true,
  userId: true,
});

export const updateWorkoutLogSchema = insertWorkoutLogSchema.partial();

export type InsertWorkoutLog = z.infer<typeof insertWorkoutLogSchema>;
export type UpdateWorkoutLog = z.infer<typeof updateWorkoutLogSchema>;
export type WorkoutLog = typeof workoutLogs.$inferSelect;

export type TimelineEntry = {
  id: string;
  date: string;
  type: "planned" | "logged";
  status: WorkoutStatus;
  focus: string;
  mainWorkout: string;
  accessory: string | null;
  notes: string | null;
  duration?: number | null;
  rpe?: number | null;
  planDayId?: string | null;
  workoutLogId?: string | null;
  weekNumber?: number;
  dayName?: string;
};
