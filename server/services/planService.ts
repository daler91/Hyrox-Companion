import type { InsertPlanDay, TrainingPlanWithDays, UpdatePlanDay } from "@shared/schema";
import { exerciseSets, planDays, trainingPlans, workoutLogs } from "@shared/schema";
import { parse } from "csv-parse/sync";
import { and,eq } from "drizzle-orm";

import { db } from "../db";
import { AppError, ErrorCode } from "../errors";
import { logger } from "../logger";
import { queue } from "../queue";
import { samplePlanDays } from "../samplePlan";
import { storage } from "../storage";

interface CSVRow {
  Week: string;
  Day: string;
  Focus: string;
  "Main Workout": string;
  "Accessory/Engine Work": string;
  Accessory?: string;
  Notes: string;
}

function getCSVParseOptions() {
  return {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true,
  } as const;
}

function parseCSVContent(csvText: string): unknown[] {
  try {
    return parse(csvText, getCSVParseOptions());
  } catch (error) {
    logger.error({ err: error }, "CSV parse error:");
    return [];
  }
}

function toStr(val: unknown): string {
  if (typeof val === "string") return val;
  if (typeof val === "number") return String(val);
  return "";
}

export function validateAndMapCSVRows(records: unknown[]): CSVRow[] {
  if (!Array.isArray(records)) return [];

  return records.map((record) => {
    const row = record as Record<string, unknown>;
    return {
      Week: toStr(row.Week),
      Day: toStr(row.Day),
      Focus: toStr(row.Focus),
      "Main Workout": toStr(row["Main Workout"]),
      "Accessory/Engine Work": toStr(row["Accessory/Engine Work"]),
      Accessory: toStr(row["Accessory"]),
      Notes: toStr(row.Notes),
    } as CSVRow;
  });
}

function parseCSV(csvText: string): CSVRow[] {
  const records = parseCSVContent(csvText);
  return validateAndMapCSVRows(records);
}

export async function importPlanFromCSV(
  csvContent: string,
  userId: string,
  options?: { fileName?: string; planName?: string },
): Promise<TrainingPlanWithDays> {
  const rows = parseCSV(csvContent);
  if (rows.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "No valid rows found in CSV", 400);
  }

  // ⚡ Bolt Performance Optimization: Combine map and filter into a single O(N) reduction to prevent intermediate array allocations.
  const weekNumbers = rows.reduce<number[]>((acc, r) => {
    const n = Number.parseInt(r.Week, 10);
    if (!Number.isNaN(n) && n > 0) acc.push(n);
    return acc;
  }, []);
  if (weekNumbers.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "No valid week numbers found in CSV", 400);
  }
  const uniqueWeeks = new Set(weekNumbers);
  const totalWeeks = uniqueWeeks.size;

  const plan = await storage.plans.createTrainingPlan({
    userId,
    name: options?.planName || options?.fileName?.replace(".csv", "") || "Imported Plan",
    sourceFileName: options?.fileName || null,
    totalWeeks,
  });

  // ⚡ Bolt Performance Optimization: Combine filter and map into a single O(N) reduction to prevent intermediate array allocations.
  const days: InsertPlanDay[] = rows.reduce<InsertPlanDay[]>((acc, row) => {
    if (row.Week && row.Day) {
      const accessory = row.Accessory || row["Accessory/Engine Work"] || null;
      acc.push({
        planId: plan.id,
        weekNumber: Number.parseInt(row.Week, 10) || 1,
        dayName: row.Day,
        focus: row.Focus || "",
        mainWorkout: row["Main Workout"] || "",
        accessory,
        notes: row.Notes || null,
        status: "planned",
      });
    }
    return acc;
  }, []);

  await storage.plans.createPlanDays(days);

  const fullPlan = await storage.plans.getTrainingPlan(plan.id, userId);
  if (!fullPlan) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      `Failed to retrieve training plan ${plan.id} after creation`,
      500,
    );
  }
  return fullPlan;
}

export async function createSamplePlan(userId: string): Promise<TrainingPlanWithDays> {
  const plan = await storage.plans.createTrainingPlan({
    userId,
    name: "8-Week Functional Fitness Plan",
    sourceFileName: null,
    totalWeeks: 8,
  });

  const days: InsertPlanDay[] = samplePlanDays.map((d) => ({
    planId: plan.id,
    weekNumber: d.week,
    dayName: d.day,
    focus: d.focus,
    mainWorkout: d.main,
    accessory: d.accessory,
    notes: d.notes,
    status: "planned",
  }));

  await storage.plans.createPlanDays(days);

  const fullPlan = await storage.plans.getTrainingPlan(plan.id, userId);
  if (!fullPlan) {
    throw new AppError(
      ErrorCode.INTERNAL_ERROR,
      `Failed to retrieve training plan ${plan.id} after creation`,
      500,
    );
  }
  return fullPlan;
}

export async function updatePlanDayWithCleanup(
  dayId: string,
  updates: UpdatePlanDay,
  userId: string,
) {
  if (updates.mainWorkout !== undefined) {
    return await db.transaction(async (tx) => {
      const [linkedLog] = await tx
        .select()
        .from(workoutLogs)
        .where(and(eq(workoutLogs.planDayId, dayId), eq(workoutLogs.userId, userId)))
        .limit(1);

      if (linkedLog) {
        await tx.delete(exerciseSets).where(eq(exerciseSets.workoutLogId, linkedLog.id));
      }

      const day = await tx
        .select({ planDay: planDays })
        .from(planDays)
        .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
        .where(and(eq(planDays.id, dayId), eq(trainingPlans.userId, userId)));

      if (day.length === 0) return undefined;

      const [updatedDay] = await tx
        .update(planDays)
        .set(updates)
        .where(eq(planDays.id, dayId))
        .returning();

      return updatedDay;
    });
  }

  return await storage.plans.updatePlanDay(dayId, updates, userId);
}

export async function updatePlanDayStatus(
  dayId: string,
  {
    status,
    scheduledDate,
  }: { status?: "planned" | "completed" | "skipped" | "missed"; scheduledDate?: string | null },
  userId: string,
) {
  const updates: Record<string, string | null> = {};
  if (status) updates.status = status;
  if (scheduledDate !== undefined) updates.scheduledDate = scheduledDate ?? null;

  if (status && status !== "completed") {
    // Drop the workout log that represented the completed state. Any edits
    // the user made while the workout was completed have already been mirrored
    // onto the plan day by workoutService.updateWorkout / createWorkoutInTx,
    // so the plan day retains them after the log is deleted.
    await storage.workouts.deleteWorkoutLogByPlanDayId(dayId, userId);
  }

  const updatedDay = await storage.plans.updatePlanDay(dayId, updates, userId);

  if (updatedDay && status === "completed") {
    queue
      .send("auto-coach", { userId })
      .catch((err) => logger.error({ err }, "Failed to queue auto-coach job"));
  }

  return updatedDay;
}
