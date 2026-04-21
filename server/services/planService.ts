import type { InsertPlanDay, TrainingPlanWithDays, UpdatePlanDay } from "@shared/schema";
import { exerciseSets, planDays, trainingPlans, workoutLogs } from "@shared/schema";
import { parse } from "csv-parse/sync";
import { and,asc, eq } from "drizzle-orm";

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

const VALID_DAY_NAMES = new Set([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

// Canonicalize to title case so downstream scheduling (which now compares
// case-insensitively) and any UI that renders day names see a consistent value.
function canonicalizeDayName(raw: string): string {
  const lower = raw.trim().toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// Any plan that claims to span more than a year is almost certainly the
// result of a typo (someone put "2024" or "52" in the Week column by
// accident). Capping pre-insert keeps `totalWeeks` sane for downstream
// analytics like getPlanWeeklyDensity and the plan header.
const MAX_PLAN_WEEKS = 52;

interface ParsedCSVRows {
  weekNumbers: number[];
  invalidDayNames: string[];
  validRows: { weekNumber: number; dayName: string; row: CSVRow }[];
}

function collectCSVRows(rows: CSVRow[]): ParsedCSVRows {
  const weekNumbers: number[] = [];
  const invalidDayNames: string[] = [];
  const validRows: ParsedCSVRows["validRows"] = [];
  for (const row of rows) {
    const n = Number.parseInt(row.Week, 10);
    if (!Number.isNaN(n) && n > 0) weekNumbers.push(n);
    if (!row.Week || !row.Day) continue;
    const lowered = row.Day.trim().toLowerCase();
    if (!VALID_DAY_NAMES.has(lowered)) {
      invalidDayNames.push(row.Day);
      continue;
    }
    validRows.push({
      weekNumber: Number.parseInt(row.Week, 10) || 1,
      dayName: canonicalizeDayName(row.Day),
      row,
    });
  }
  return { weekNumbers, invalidDayNames, validRows };
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

  // Validate everything against the parsed rows BEFORE touching the database.
  // Previously a failed rollback (deleteTrainingPlan) could leave an orphaned
  // empty plan on the user's account.
  const { weekNumbers, invalidDayNames, validRows } = collectCSVRows(rows);

  if (weekNumbers.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "No valid week numbers found in CSV", 400);
  }
  if (invalidDayNames.length > 0) {
    const sample = [...new Set(invalidDayNames)].slice(0, 5).join(", ");
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      `CSV contains ${invalidDayNames.length} row(s) with unrecognized Day values (e.g., ${sample}). Use Monday–Sunday.`,
      400,
    );
  }
  if (validRows.length === 0) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      "CSV has no rows with both a Week and a Day — plan must have at least one day.",
      400,
    );
  }

  // Use the actual span (max - min + 1) rather than the count of unique weeks
  // so non-contiguous imports (e.g. weeks 1, 3, 5) don't under-report duration
  // and make analytics like workouts-per-week over-estimate.
  const rawSpan = Math.max(...weekNumbers) - Math.min(...weekNumbers) + 1;
  if (rawSpan > MAX_PLAN_WEEKS) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      `Plan span is ${rawSpan} weeks, which exceeds the ${MAX_PLAN_WEEKS}-week maximum. Check the Week column for typos (e.g., years or extra digits).`,
      400,
    );
  }
  const totalWeeks = rawSpan;

  const plan = await storage.plans.createTrainingPlan({
    userId,
    name: options?.planName || options?.fileName?.replace(".csv", "") || "Imported Plan",
    sourceFileName: options?.fileName || null,
    totalWeeks,
  });

  const days: InsertPlanDay[] = validRows.map(({ weekNumber, dayName, row }) => ({
    planId: plan.id,
    weekNumber,
    dayName,
    focus: row.Focus || "",
    mainWorkout: row["Main Workout"] || "",
    accessory: row.Accessory || row["Accessory/Engine Work"] || null,
    notes: row.Notes || null,
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
  // Note: previously this path wiped the linked workout_log's exercise_sets
  // whenever mainWorkout changed — a leftover from the free-text-primary
  // model where the sets were derived from the text. In the structured-
  // exercise model, exercise_sets are the source of truth and are owned
  // independently (by the athlete's edits). Keeping the athletes' sets
  // through a prescription-text edit is the whole point of letting them
  // tweak the free text alongside the structured rows. Use the /reparse
  // endpoint when the athlete explicitly wants the text converted into
  // new structured rows.
  return await storage.plans.updatePlanDay(dayId, updates, userId);
}

type PlanDayStatus = "planned" | "completed" | "skipped" | "missed";

// Allowed transitions for user-driven status changes. Same-state transitions
// are idempotent (always allowed). The "missed" state is primarily written by
// the nightly cron, but users can correct it (log late = completed, reschedule
// = planned). "skipped → missed" and "missed → skipped" are disallowed to keep
// analytics unambiguous (skipped = user choice; missed = system-detected).
const ALLOWED_TRANSITIONS: Record<PlanDayStatus, readonly PlanDayStatus[]> = {
  planned: ["completed", "skipped", "missed"],
  completed: ["planned", "skipped"],
  missed: ["completed", "planned"],
  skipped: ["planned", "completed"],
};

export async function updatePlanDayStatus(
  dayId: string,
  {
    status,
    scheduledDate,
  }: { status?: PlanDayStatus; scheduledDate?: string | null },
  userId: string,
) {
  // Date-only update: no transition check needed.
  if (!status) {
    const updates: Record<string, string | null> = {};
    if (scheduledDate !== undefined) updates.scheduledDate = scheduledDate ?? null;
    return await storage.plans.updatePlanDay(dayId, updates, userId);
  }

  // Transition path: do the read, transition check, optional log cleanup,
  // and write inside a single transaction so a concurrent cron or workout
  // mutation can't race the check and sneak through a forbidden from-state.
  const updatedDay = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: planDays.status })
      .from(planDays)
      .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
      .where(and(eq(planDays.id, dayId), eq(trainingPlans.userId, userId)))
      .for("update");

    if (!current) {
      throw new AppError(ErrorCode.NOT_FOUND, "Plan day not found", 404);
    }

    const from = current.status as PlanDayStatus;
    if (from !== status && !ALLOWED_TRANSITIONS[from].includes(status)) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Invalid plan-day status transition: ${from} → ${status}`,
        400,
      );
    }

    const updates: Record<string, string | null> = { status };
    if (scheduledDate !== undefined) updates.scheduledDate = scheduledDate ?? null;

    // Only clean up the linked workout log when actually leaving "completed".
    // Running this on same-state idempotent writes (e.g. planned → planned)
    // or transitions that don't involve "completed" would silently destroy
    // user data (R8).
    if (from === "completed" && status !== "completed") {
      const [existingLog] = await tx
        .select()
        .from(workoutLogs)
        .where(and(eq(workoutLogs.planDayId, dayId), eq(workoutLogs.userId, userId)))
        .limit(1);
      if (existingLog) {
        // Preserve edits made on the workout log back onto the plan day so
        // the un-completed day reflects the user's last-known content —
        // both the free-text fields AND the structured exercise_sets.
        // Previously only the text survived; the athlete's actual logged
        // sets got wiped when they toggled status back to planned, which
        // made re-completing restart from the coach's original prescription
        // instead of their edits.
        updates.focus = existingLog.focus;
        updates.mainWorkout = existingLog.mainWorkout;
        updates.accessory = existingLog.accessory;
        updates.notes = existingLog.notes;

        // Snapshot the logged sets, then replace the plan day's prescribed
        // sets with them. We re-map the rows from workoutLogId-owned to
        // planDayId-owned by inserting fresh rows (the exercise_set_single_
        // owner_check constraint makes in-place ownership swaps illegal).
        const loggedSets = await tx
          .select()
          .from(exerciseSets)
          .where(eq(exerciseSets.workoutLogId, existingLog.id))
          .orderBy(asc(exerciseSets.sortOrder));

        await tx.delete(exerciseSets).where(eq(exerciseSets.planDayId, dayId));

        if (loggedSets.length > 0) {
          await tx.insert(exerciseSets).values(
            loggedSets.map((s) => ({
              workoutLogId: null,
              planDayId: dayId,
              exerciseName: s.exerciseName,
              customLabel: s.customLabel,
              category: s.category,
              setNumber: s.setNumber,
              reps: s.reps,
              weight: s.weight,
              distance: s.distance,
              time: s.time,
              notes: s.notes,
              confidence: s.confidence,
              sortOrder: s.sortOrder,
            })),
          );
        }

        // Delete the log last — its exercise_sets cascade, but we've
        // already copied them to the plan day above.
        await tx
          .delete(workoutLogs)
          .where(and(eq(workoutLogs.planDayId, dayId), eq(workoutLogs.userId, userId)));
      }
    }

    const [row] = await tx
      .update(planDays)
      .set(updates)
      .where(eq(planDays.id, dayId))
      .returning();

    return row;
  });

  if (updatedDay && status === "completed") {
    queue
      .send("auto-coach", { userId })
      .catch((err) => logger.error({ err }, "Failed to queue auto-coach job"));
  }

  return updatedDay;
}
