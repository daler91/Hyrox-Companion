import { logger } from "../logger";
import { storage } from "../storage";
import { db } from "../db";
import { parse } from "csv-parse/sync";
import { exerciseSets, planDays, trainingPlans, workoutLogs } from "@shared/schema";
import type { InsertPlanDay, TrainingPlanWithDays, UpdatePlanDay } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { samplePlanDays } from "../samplePlan";

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

export function validateAndMapCSVRows(records: unknown[]): CSVRow[] {
  if (!Array.isArray(records)) return [];

  return records.map(record => {
    const row = record as Record<string, any>;
    return {
      Week: String(row.Week || ''),
      Day: String(row.Day || ''),
      Focus: String(row.Focus || ''),
      "Main Workout": String(row["Main Workout"] || ''),
      "Accessory/Engine Work": String(row["Accessory/Engine Work"] || ''),
      Accessory: String(row["Accessory"] || ''),
      Notes: String(row.Notes || ''),
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
  options?: { fileName?: string; planName?: string }
): Promise<TrainingPlanWithDays> {
  const rows = parseCSV(csvContent);
  if (rows.length === 0) {
    throw new Error("No valid rows found in CSV");
  }

  const weekNumbers = rows.map((r) => Number.parseInt(r.Week, 10)).filter((n) => !Number.isNaN(n) && n > 0);
  if (weekNumbers.length === 0) {
    throw new Error("No valid week numbers found in CSV");
  }
  const uniqueWeeks = new Set(weekNumbers);
  const totalWeeks = uniqueWeeks.size;

  const plan = await storage.createTrainingPlan({
    userId,
    name: options?.planName || options?.fileName?.replace(".csv", "") || "Imported Plan",
    sourceFileName: options?.fileName || null,
    totalWeeks,
  });

  const days: InsertPlanDay[] = rows
    .filter((row) => row.Week && row.Day)
    .map((row) => {
      const accessory = row.Accessory || row["Accessory/Engine Work"] || null;
      return {
        userId: userId,
        planId: plan.id,
        weekNumber: Number.parseInt(row.Week, 10) || 1,
        dayName: row.Day,
        focus: row.Focus || "",
        mainWorkout: row["Main Workout"] || "",
        accessory,
        notes: row.Notes || null,
        status: "planned",
      };
    });

  await storage.createPlanDays(days);

  const fullPlan = await storage.getTrainingPlan(plan.id, userId);
  return fullPlan!;
}

export async function createSamplePlan(userId: string): Promise<TrainingPlanWithDays> {
  const plan = await storage.createTrainingPlan({
    userId,
    name: "8-Week Hyrox Training Plan",
    sourceFileName: null,
    totalWeeks: 8,
  });

  const days: InsertPlanDay[] = samplePlanDays.map((d) => ({
    userId: userId,
    planId: plan.id,
    weekNumber: d.week,
    dayName: d.day,
    focus: d.focus,
    mainWorkout: d.main,
    accessory: d.accessory,
    notes: d.notes,
    status: "planned",
  }));

  await storage.createPlanDays(days);

  const fullPlan = await storage.getTrainingPlan(plan.id, userId);
  return fullPlan!;
}

export async function updatePlanDayWithCleanup(
  dayId: string,
  updates: UpdatePlanDay,
  userId: string
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
        .where(and(eq(planDays.id, dayId), eq(planDays.userId, userId)));

      if (day.length === 0) return undefined;

      const [updatedDay] = await tx
        .update(planDays)
        .set(updates)
        .where(and(eq(planDays.id, dayId), eq(planDays.userId, userId)))
        .returning();

      return updatedDay;
    });
  }

  return await storage.updatePlanDay(dayId, updates, userId);
}
