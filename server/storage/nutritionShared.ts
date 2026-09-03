/**
 * Shared helpers for the nutrition storage modules (A8).
 *
 * Extracted from the single NutritionStorage class so each sub-domain is a
 * focused, separately-testable module; `nutrition.ts` keeps the class as the
 * storage facade's entry point, with every method name unchanged.
 */
import {
  type Food,
  type FoodEntryMethod,
  foodLogEntries,
  foods,
  type FoodWithPortionMemory,
  type MealType,
} from "@shared/schema";
import {
  and,
  desc,
  eq,
  inArray,
  sql,
} from "drizzle-orm";

import { db } from "../db";

/**
 * Run a delete-then-insert version write, retrying exactly once when it loses a
 * concurrent race on the named unique index (23505). The retry's delete sees
 * the winner's committed row and replaces it — last writer wins, matching what
 * serialized saves of the same form would produce. Any other error, and a
 * second conflict on the retry, propagate. Checks the cause chain because
 * drizzle can wrap the pg error. Exported for testing.
 */
export async function retryOnceOnUniqueViolation<T>(
  indexName: string,
  write: () => Promise<T>,
): Promise<T> {
  const isViolation = (error: unknown): boolean => {
    let current: unknown = error;
    for (let depth = 0; current && typeof current === "object" && depth < 5; depth++) {
      const rec = current as { code?: unknown; constraint?: unknown; cause?: unknown };
      if (rec.code === "23505" && rec.constraint === indexName) return true;
      current = rec.cause;
    }
    return false;
  };
  try {
    return await write();
  } catch (err) {
    if (!isViolation(err)) throw err;
    return await write();
  }
}

export const DEFAULT_SEARCH_LIMIT = 25;
// The pg_trgm.similarity_threshold GUC default. The fuzzy WHERE uses the `%`
// operator (index-servable), which reads that GUC — this constant is no longer
// interpolated into the SQL. It exists to DOCUMENT and TEST the coupling: if a
// different threshold is ever needed, the GUC must be SET per pooled connection
// AND this constant updated to match.
// Exported ONLY for the SQL-shape regression test (nutrition.searchShape.test.ts).
export const TRGM_SIMILARITY_THRESHOLD = 0.3;

/** A local search hit carrying the pg_trgm similarity (0 when fuzzy is off) so the
 *  orchestrator's ranker can promote good typo matches. Extends `Food`; the extra
 *  field is computed at query time and never persisted. */
export type LocalFood = Food & { _localSim?: number };

/** Escape LIKE metacharacters in user input (backslash is the default escape char). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Visibility predicate for the mixed shared + per-user `foods` table: a row is
 * visible if it's owned by the requesting user, comes from the shared provider
 * cache (any non-custom source — USDA/OFF/etc.), or is a custom food its owner
 * explicitly shared publicly. Applied to EVERY food-by-id resolution and
 * listing so custom foods never leak cross-user.
 *
 * Deliberately NOT "createdByUserId IS NULL means shared": the owner FK is
 * set-null on account deletion, so under that rule a deleted user's private
 * custom foods became visible to everyone. Custom-source rows are only ever
 * visible beyond their owner via the explicit is_public opt-in.
 *
 * Exported ONLY for the SQL-shape regression test (nutrition.visibility.test.ts).
 */
export function visibleTo(userId: string) {
  return sql`(${foods.createdByUserId} = ${userId} OR ${foods.source} <> 'custom' OR ${foods.isPublic} = true)`;
}

/**
 * One search variant's WHERE fragment: name/brand substring match plus, when
 * fuzzy is on, a trigram match. Uses the `%` OPERATOR (not `similarity(...) >= x`)
 * deliberately: gin_trgm_ops can serve `%` and infix LIKE via a BitmapOr over
 * idx_foods_name_trgm / idx_foods_brand_trgm (migration 0074), whereas a
 * similarity() function predicate is structurally unservable and forces a
 * sequential scan of the whole shared foods table. `%` reads the
 * pg_trgm.similarity_threshold GUC (PostgreSQL default 0.3, never overridden in
 * this repo == TRGM_SIMILARITY_THRESHOLD). Do not regress to similarity() in
 * the WHERE; it stays only in the SELECT/ORDER BY, where it runs on matched
 * rows. The brand arms keep an explicit `is not null` so qualification for the
 * partial brand index never depends on the planner's strict-operator proof.
 *
 * Exported ONLY for the SQL-shape regression test (nutrition.searchShape.test.ts).
 */
/**
 * The most recent log entry per food, for the given ids.
 *
 * `DISTINCT ON (food_id)` with `ORDER BY food_id, logged_at DESC` keeps the
 * newest row per food. The two ORDER BY terms are load-bearing and easy to
 * break: Postgres requires the leading term to match the DISTINCT ON
 * expression, and dropping the `DESC` silently returns the *oldest* portion —
 * a wrong answer rather than an error. Hence the shape test.
 *
 * Exported ONLY for the SQL-shape regression test (nutrition.searchShape.test.ts).
 */
export function buildLastPortionsQuery(userId: string, foodIds: string[]) {
  return db
    .selectDistinctOn([foodLogEntries.foodId], {
      foodId: foodLogEntries.foodId,
      quantityG: foodLogEntries.quantityG,
      mealType: foodLogEntries.mealType,
    })
    .from(foodLogEntries)
    .where(and(eq(foodLogEntries.userId, userId), inArray(foodLogEntries.foodId, foodIds)))
    .orderBy(foodLogEntries.foodId, desc(foodLogEntries.loggedAt));
}

export function buildVariantMatch(v: string, fuzzy: boolean) {
  const contains = `%${escapeLike(v)}%`;
  const base = sql`(lower(${foods.name}) like ${contains} or (${foods.brand} is not null and lower(${foods.brand}) like ${contains}))`;
  return fuzzy
    ? sql`(${base} or lower(${foods.name}) % ${v} or (${foods.brand} is not null and lower(${foods.brand}) % ${v}))`
    : base;
}

export interface CreateLogEntryData {
  foodId: string;
  quantityG: number;
  mealType: MealType;
  loggedAt: Date;
  logDate: string;
  entryMethod?: FoodEntryMethod;
  // Provenance for AI-assisted entries (Phase 4); null/false for manual/barcode.
  rawInput?: string | null;
  parseConfidence?: number | null;
  pendingReview?: boolean;
}

export interface UpdateLogEntryPatch {
  quantityG?: number;
  mealType?: MealType;
  // loggedAt and its derived logDate move together (the route recomputes logDate).
  loggedAt?: Date;
  logDate?: string;
}


/**
 * The portion and meal each of `foodIds` was last logged in.
 *
 * Kept as a separate bounded query rather than folded into the aggregates
 * below so the callers keep their existing ordering and limits — the id list
 * is already capped before this runs.
 */
export async function getLastPortions(
  userId: string,
  foodIds: string[],
): Promise<Map<string, { quantityG: number; mealType: MealType }>> {
  if (foodIds.length === 0) return new Map();
  const rows = await buildLastPortionsQuery(userId, foodIds);
  return new Map(
    rows.map((r) => [r.foodId, { quantityG: r.quantityG, mealType: r.mealType as MealType }]),
  );
}


/** Attach each food's last-used portion, or nulls when it has never been logged. */
export function withPortionMemory(
  items: Food[],
  portions: Map<string, { quantityG: number; mealType: MealType }>,
): FoodWithPortionMemory[] {
  return items.map((food) => {
    const last = portions.get(food.id);
    return {
      ...food,
      lastQuantityG: last?.quantityG ?? null,
      lastMealType: last?.mealType ?? null,
    };
  });
}
