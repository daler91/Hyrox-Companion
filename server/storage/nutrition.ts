import {
  type Food,
  type FoodFavorite,
  foodFavorites,
  foodLogEntries,
  type FoodLogEntry,
  foods,
  type MealType,
} from "@shared/schema";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { db, type DbExecutor } from "../db";
import type { LogEntryWithFood } from "../services/nutrition/rollup";
import type { UsdaFoodMapped } from "../services/nutrition/usdaClient";

const DEFAULT_SEARCH_LIMIT = 25;

/** Escape LIKE metacharacters in user input (backslash is the default escape char). */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

interface CreateLogEntryData {
  foodId: string;
  quantityG: number;
  mealType: MealType;
  loggedAt: Date;
  logDate: string;
}

interface UpdateLogEntryPatch {
  quantityG?: number;
  mealType?: MealType;
  // loggedAt and its derived logDate move together (the route recomputes logDate).
  loggedAt?: Date;
  logDate?: string;
}

/**
 * Data access for the nutrition module. Follows the codebase's majority storage
 * pattern: uses `db` directly, with an optional `DbExecutor` only where a caller
 * might compose a transaction. Every per-user read/write scopes its SQL `WHERE`
 * by `userId`, so a foreign id resolves to "not found" rather than leaking.
 */
export class NutritionStorage {
  // --- foods (shared reference cache) ---------------------------------------

  /**
   * Search the local `foods` cache case-insensitively. Contains-match, ranking
   * prefix hits first. This is the fast/offline path and the fallback when the
   * USDA API is unavailable.
   */
  async searchLocalFoods(query: string, limit = DEFAULT_SEARCH_LIMIT): Promise<Food[]> {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [];
    const escaped = escapeLike(q);
    const prefix = `${escaped}%`;
    const contains = `%${escaped}%`;
    return db
      .select()
      .from(foods)
      .where(sql`lower(${foods.name}) like ${contains}`)
      .orderBy(
        sql`case when lower(${foods.name}) like ${prefix} then 0 else 1 end`,
        asc(foods.name),
      )
      .limit(limit);
  }

  /** Cache USDA results into `foods`, upserting on (source, source_id). */
  async upsertFoods(mapped: UsdaFoodMapped[], executor: DbExecutor = db): Promise<Food[]> {
    if (mapped.length === 0) return [];
    // Dedupe within the batch so ON CONFLICT can't try to touch one row twice.
    const byKey = new Map<string, UsdaFoodMapped>();
    for (const m of mapped) byKey.set(`${m.source}:${m.sourceId}`, m);
    const values = [...byKey.values()].map((m) => ({
      source: m.source,
      sourceId: m.sourceId,
      name: m.name,
      brand: m.brand,
      servingSizeG: m.servingSizeG,
      caloriesPer100g: m.caloriesPer100g,
      proteinPer100g: m.proteinPer100g,
      carbPer100g: m.carbPer100g,
      fatPer100g: m.fatPer100g,
      fiberPer100g: m.fiberPer100g,
    }));

    return executor
      .insert(foods)
      .values(values)
      .onConflictDoUpdate({
        target: [foods.source, foods.sourceId],
        // Match the partial unique index predicate so the conflict target infers.
        targetWhere: sql`${foods.sourceId} is not null`,
        set: {
          name: sql`excluded.name`,
          brand: sql`excluded.brand`,
          servingSizeG: sql`excluded.serving_size_g`,
          caloriesPer100g: sql`excluded.calories_per_100g`,
          proteinPer100g: sql`excluded.protein_per_100g`,
          carbPer100g: sql`excluded.carb_per_100g`,
          fatPer100g: sql`excluded.fat_per_100g`,
          fiberPer100g: sql`excluded.fiber_per_100g`,
          updatedAt: new Date(),
        },
      })
      .returning();
  }

  async getFoodById(id: string): Promise<Food | undefined> {
    const [row] = await db.select().from(foods).where(eq(foods.id, id));
    return row;
  }

  /** Distinct foods from the user's most recent log entries, newest first (FR-1.4). */
  async getRecentFoods(userId: string, limit = 20): Promise<Food[]> {
    const recent = await db
      .select({
        foodId: foodLogEntries.foodId,
        lastLogged: sql<string>`max(${foodLogEntries.loggedAt})`,
      })
      .from(foodLogEntries)
      .where(eq(foodLogEntries.userId, userId))
      .groupBy(foodLogEntries.foodId)
      .orderBy(desc(sql`max(${foodLogEntries.loggedAt})`))
      .limit(limit);

    if (recent.length === 0) return [];
    const ids = recent.map((r) => r.foodId);
    const rows = await db.select().from(foods).where(inArray(foods.id, ids));
    const byId = new Map(rows.map((f) => [f.id, f]));
    // Preserve recency order from the grouped query.
    return ids.map((id) => byId.get(id)).filter((f): f is Food => Boolean(f));
  }

  // --- log entries ----------------------------------------------------------

  async createLogEntry(
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
        entryMethod: "manual",
      })
      .returning();
    return row;
  }

  /** A day's entries joined to their foods, ordered by time, for the daily view. */
  async listEntriesWithFoodForDate(userId: string, logDate: string): Promise<LogEntryWithFood[]> {
    const rows = await db
      .select({ entry: foodLogEntries, food: foods })
      .from(foodLogEntries)
      .innerJoin(foods, eq(foodLogEntries.foodId, foods.id))
      .where(and(eq(foodLogEntries.userId, userId), eq(foodLogEntries.logDate, logDate)))
      .orderBy(asc(foodLogEntries.loggedAt));
    return rows.map((r) => ({ ...r.entry, food: r.food }));
  }

  async updateLogEntry(
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

  async deleteLogEntry(userId: string, id: string): Promise<boolean> {
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
  async repeatDay(
    userId: string,
    params: { sourceDate: string; mealType?: MealType; targetDate: string; loggedAt: Date },
  ): Promise<number> {
    const conditions = [
      eq(foodLogEntries.userId, userId),
      eq(foodLogEntries.logDate, params.sourceDate),
    ];
    if (params.mealType) conditions.push(eq(foodLogEntries.mealType, params.mealType));

    const sources = await db.select().from(foodLogEntries).where(and(...conditions));
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

  // --- favorites ------------------------------------------------------------

  async listFavorites(userId: string): Promise<Food[]> {
    const rows = await db
      .select({ food: foods })
      .from(foodFavorites)
      .innerJoin(foods, eq(foodFavorites.foodId, foods.id))
      .where(eq(foodFavorites.userId, userId))
      .orderBy(desc(foodFavorites.createdAt));
    return rows.map((r) => r.food);
  }

  /** Add a favorite; idempotent (no error if already favorited). */
  async addFavorite(userId: string, foodId: string): Promise<FoodFavorite | undefined> {
    const [row] = await db
      .insert(foodFavorites)
      .values({ userId, foodId })
      .onConflictDoNothing({ target: [foodFavorites.userId, foodFavorites.foodId] })
      .returning();
    return row;
  }

  async removeFavorite(userId: string, foodId: string): Promise<boolean> {
    const result = await db
      .delete(foodFavorites)
      .where(and(eq(foodFavorites.userId, userId), eq(foodFavorites.foodId, foodId)))
      .returning({ id: foodFavorites.id });
    return result.length > 0;
  }
}
