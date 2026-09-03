/**
 * Food log entries and the date/window reads the summaries build on (A8).
 *
 * Extracted from the single NutritionStorage class so each sub-domain is a
 * focused, separately-testable module; `nutrition.ts` keeps the class as the
 * storage facade's entry point, with every method name unchanged.
 */
import {
  type FoodEntryMethod,
  foodLogEntries,
  type FoodLogEntry,
  foods,
  type MealType,
} from "@shared/schema";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  lte,
  sql,
} from "drizzle-orm";

import { db, type DbExecutor } from "../db";
import { type LogEntryWithFood } from "../services/nutrition/rollup";
import { type CreateLogEntryData, type UpdateLogEntryPatch } from "./nutritionShared";


// --- log entries ----------------------------------------------------------

export async function createLogEntry(
  userId: string,
  data: CreateLogEntryData,
  executor: DbExecutor = db,
): Promise<FoodLogEntry> {
  const [row] = await executor
    .insert(foodLogEntries)
    .values({
      userId,
      foodId: data.foodId,
      loggedAt: data.loggedAt,
      logDate: data.logDate,
      quantityG: data.quantityG,
      mealType: data.mealType,
      entryMethod: data.entryMethod ?? "manual",
      rawInput: data.rawInput ?? null,
      parseConfidence: data.parseConfidence ?? null,
      pendingReview: data.pendingReview ?? false,
    })
    .returning();
  return row;
}


/**
 * Persist a batch of reviewed entries in one atomic multi-row insert (FR-4.1).
 * All share the capture metadata (entryMethod, rawInput, loggedAt, logDate);
 * each item carries its own food/quantity/meal and optional parse confidence.
 * `pendingReview` is false — the user reviewed every item before confirming.
 */
export async function createLogEntriesBatch(
  userId: string,
  data: {
    entryMethod: FoodEntryMethod;
    rawInput?: string | null;
    loggedAt: Date;
    logDate: string;
    items: {
      foodId: string;
      quantityG: number;
      mealType: MealType;
      parseConfidence?: number | null;
    }[];
  },
): Promise<FoodLogEntry[]> {
  if (data.items.length === 0) return [];
  const rows = data.items.map((item) => ({
    userId,
    foodId: item.foodId,
    loggedAt: data.loggedAt,
    logDate: data.logDate,
    quantityG: item.quantityG,
    mealType: item.mealType,
    entryMethod: data.entryMethod,
    rawInput: data.rawInput ?? null,
    parseConfidence: item.parseConfidence ?? null,
    pendingReview: false,
  }));
  return db.insert(foodLogEntries).values(rows).returning();
}


/** A day's entries joined to their foods, ordered by time, for the daily view. */
export async function listEntriesWithFoodForDate(userId: string, logDate: string): Promise<LogEntryWithFood[]> {
  const rows = await db
    .select({ entry: foodLogEntries, food: foods })
    .from(foodLogEntries)
    .innerJoin(foods, eq(foodLogEntries.foodId, foods.id))
    .where(and(eq(foodLogEntries.userId, userId), eq(foodLogEntries.logDate, logDate)))
    .orderBy(asc(foodLogEntries.loggedAt));
  return rows.map((r) => ({ ...r.entry, food: r.food }));
}


/** True when the user logged anything on `logDate` (reminder gates). */
export async function hasEntriesOnDate(userId: string, logDate: string): Promise<boolean> {
  const [row] = await db
    .select({ id: foodLogEntries.id })
    .from(foodLogEntries)
    .where(and(eq(foodLogEntries.userId, userId), eq(foodLogEntries.logDate, logDate)))
    .limit(1);
  return row !== undefined;
}


/** True when the user has logged anything at/after `since` — the "actually
 *  uses nutrition logging" gate, so reminders never nag lapsed or
 *  never-started users. */
export async function hasEntriesSince(userId: string, since: Date): Promise<boolean> {
  const [row] = await db
    .select({ id: foodLogEntries.id })
    .from(foodLogEntries)
    .where(and(eq(foodLogEntries.userId, userId), gte(foodLogEntries.loggedAt, since)))
    .limit(1);
  return row !== undefined;
}


/**
 * Entries joined to foods whose `loggedAt` instant falls within [from, to],
 * time-ordered. Backs the session-fuelling windows when a workout has a known
 * start instant (FR-3.1/3.2; served by idx_food_log_entries_user_logged_at).
 */
export async function listEntriesWithFoodInWindow(
  userId: string,
  fromInstant: Date,
  toInstant: Date,
): Promise<LogEntryWithFood[]> {
  const rows = await db
    .select({ entry: foodLogEntries, food: foods })
    .from(foodLogEntries)
    .innerJoin(foods, eq(foodLogEntries.foodId, foods.id))
    .where(
      and(
        eq(foodLogEntries.userId, userId),
        gte(foodLogEntries.loggedAt, fromInstant),
        lte(foodLogEntries.loggedAt, toInstant),
      ),
    )
    .orderBy(asc(foodLogEntries.loggedAt));
  return rows.map((r) => ({ ...r.entry, food: r.food }));
}


/**
 * Entries joined to foods whose local `logDate` falls within [fromDate, toDate],
 * ordered by day then time. Backs the block view's daily macro totals (FR-3.3;
 * served by idx_food_log_entries_user_log_date).
 */
export async function listEntriesWithFoodForDateRange(
  userId: string,
  fromDate: string,
  toDate: string,
): Promise<LogEntryWithFood[]> {
  const rows = await db
    .select({ entry: foodLogEntries, food: foods })
    .from(foodLogEntries)
    .innerJoin(foods, eq(foodLogEntries.foodId, foods.id))
    .where(
      and(
        eq(foodLogEntries.userId, userId),
        gte(foodLogEntries.logDate, fromDate),
        lte(foodLogEntries.logDate, toDate),
      ),
    )
    .orderBy(asc(foodLogEntries.logDate), asc(foodLogEntries.loggedAt));
  return rows.map((r) => ({ ...r.entry, food: r.food }));
}


export async function updateLogEntry(
  userId: string,
  id: string,
  patch: UpdateLogEntryPatch,
): Promise<FoodLogEntry | undefined> {
  const [row] = await db
    .update(foodLogEntries)
    .set({
      ...(patch.quantityG !== undefined && { quantityG: patch.quantityG }),
      ...(patch.mealType !== undefined && { mealType: patch.mealType }),
      ...(patch.loggedAt !== undefined && { loggedAt: patch.loggedAt }),
      ...(patch.logDate !== undefined && { logDate: patch.logDate }),
      updatedAt: new Date(),
    })
    .where(and(eq(foodLogEntries.id, id), eq(foodLogEntries.userId, userId)))
    .returning();
  return row;
}


export async function deleteLogEntry(userId: string, id: string): Promise<boolean> {
  const result = await db
    .delete(foodLogEntries)
    .where(and(eq(foodLogEntries.id, id), eq(foodLogEntries.userId, userId)))
    .returning({ id: foodLogEntries.id });
  return result.length > 0;
}


/**
 * Re-log a previous day (or one meal of it) onto a target date (FR-1.5).
 * Repeated entries are stamped with `loggedAt` (the target day's instant) and
 * filed under `targetDate`. Returns the number of entries created.
 */
export async function repeatDay(
  userId: string,
  params: { sourceDate: string; mealType?: MealType; targetDate: string; loggedAt: Date },
): Promise<number> {
  const conditions = [
    eq(foodLogEntries.userId, userId),
    eq(foodLogEntries.logDate, params.sourceDate),
  ];
  if (params.mealType) conditions.push(eq(foodLogEntries.mealType, params.mealType));

  const sources = await db
    .select()
    .from(foodLogEntries)
    .where(and(...conditions));
  if (sources.length === 0) return 0;

  const rows = sources.map((s) => ({
    userId,
    foodId: s.foodId,
    loggedAt: params.loggedAt,
    logDate: params.targetDate,
    quantityG: s.quantityG,
    mealType: s.mealType,
    entryMethod: "manual" as const,
  }));
  const inserted = await db
    .insert(foodLogEntries)
    .values(rows)
    .returning({ id: foodLogEntries.id });
  return inserted.length;
}


/** The user's most recent food-log calendar date (YYYY-MM-DD), or null. The
 *  staleness anchor for nutrition insights (FR-5.3). */
export async function getLatestLogDate(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ logDate: foodLogEntries.logDate })
    .from(foodLogEntries)
    .where(eq(foodLogEntries.userId, userId))
    .orderBy(desc(foodLogEntries.logDate))
    .limit(1);
  return row?.logDate ?? null;
}


/**
 * How many food-log entries the athlete has, total. The nutrition half of the
 * analytics staleness anchor (audit L16); see countWorkoutLogs.
 */
export async function countLogEntries(userId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(foodLogEntries)
    .where(eq(foodLogEntries.userId, userId));
  return row?.total ?? 0;
}
