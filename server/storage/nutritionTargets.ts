/**
 * Daily nutrition targets and per-meal overrides, both versioned by effective date (A8).
 *
 * Extracted from the single NutritionStorage class so each sub-domain is a
 * focused, separately-testable module; `nutrition.ts` keeps the class as the
 * storage facade's entry point, with every method name unchanged.
 */
import {
  type MealTarget,
  mealTargets,
  type MealType,
  type NutritionTarget,
  nutritionTargets,
  type UpsertMealTargetInput,
  type UpsertNutritionTargetInput,
} from "@shared/schema";
import {
  and,
  desc,
  eq,
  lte,
} from "drizzle-orm";

import { db } from "../db";
import { retryOnceOnUniqueViolation } from "./nutritionShared";


// --- targets (FR-5.2) -----------------------------------------------------

/** The target effective on `onDate` — the latest version with effectiveFrom <= onDate. */
export async function getCurrentTarget(userId: string, onDate: string): Promise<NutritionTarget | undefined> {
  const [row] = await db
    .select()
    .from(nutritionTargets)
    .where(and(eq(nutritionTargets.userId, userId), lte(nutritionTargets.effectiveFrom, onDate)))
    .orderBy(desc(nutritionTargets.effectiveFrom))
    .limit(1);
  return row;
}


/** All target versions for the user, newest effective date first. */
export async function listTargets(userId: string): Promise<NutritionTarget[]> {
  return db
    .select()
    .from(nutritionTargets)
    .where(eq(nutritionTargets.userId, userId))
    .orderBy(desc(nutritionTargets.effectiveFrom));
}


/**
 * Create a target version (history is preserved across distinct effectiveFrom
 * dates). Re-saving the same day replaces that day's version in place.
 *
 * "Exactly one row per (user, effectiveFrom)" is enforced by
 * uq_nutrition_targets_user_effective (migration 0091), not by the
 * delete-then-insert alone: two concurrent saves both delete zero rows (each
 * transaction is blind to the other's uncommitted insert) and would both
 * insert. With the index, the loser gets 23505 after the winner commits and
 * is retried once — its delete then sees the committed row, so last writer
 * wins, which is the same outcome serialized saves produce.
 */
export async function createTarget(
  userId: string,
  data: UpsertNutritionTargetInput & { effectiveFrom: string },
): Promise<NutritionTarget> {
  return retryOnceOnUniqueViolation("uq_nutrition_targets_user_effective", () =>
    replaceTargetVersion(userId, data),
  );
}


export async function replaceTargetVersion(
  userId: string,
  data: UpsertNutritionTargetInput & { effectiveFrom: string },
): Promise<NutritionTarget> {
  return db.transaction(async (tx) => {
    await tx
      .delete(nutritionTargets)
      .where(
        and(
          eq(nutritionTargets.userId, userId),
          eq(nutritionTargets.effectiveFrom, data.effectiveFrom),
        ),
      );
    const [row] = await tx
      .insert(nutritionTargets)
      .values({
        userId,
        calories: data.calories ?? null,
        proteinG: data.proteinG ?? null,
        carbG: data.carbG ?? null,
        fatG: data.fatG ?? null,
        periodizationEnabled: data.periodizationEnabled ?? false,
        referenceUtss: data.referenceUtss ?? null,
        carbGramsPerUtss: data.carbGramsPerUtss ?? null,
        recoveryEnabled: data.recoveryEnabled ?? false,
        recoveryProteinBumpFrac: data.recoveryProteinBumpFrac ?? null,
        preloadCarbGramsPerUtss: data.preloadCarbGramsPerUtss ?? null,
        preloadDaysAhead: data.preloadDaysAhead ?? null,
        phaseAware: data.phaseAware ?? false,
        maxCarbDeltaG: data.maxCarbDeltaG ?? null,
        effectiveFrom: data.effectiveFrom,
      })
      .returning();
    return row;
  });
}


// --- per-meal target overrides (Phase 3) ----------------------------------

/**
 * Per-meal overrides effective on `onDate`, keyed by meal — the latest version
 * (effectiveFrom <= onDate) for each meal type. Drives the merge over the
 * engine-computed per-meal fuel targets.
 */
export async function getMealTargetOverrides(userId: string, onDate: string): Promise<Map<MealType, MealTarget>> {
  const rows = await db
    .select()
    .from(mealTargets)
    .where(and(eq(mealTargets.userId, userId), lte(mealTargets.effectiveFrom, onDate)))
    .orderBy(desc(mealTargets.effectiveFrom));
  const byMeal = new Map<MealType, MealTarget>();
  for (const row of rows) {
    const meal = row.mealType as MealType;
    if (!byMeal.has(meal)) byMeal.set(meal, row);
  }
  return byMeal;
}


/**
 * Create/replace a meal's override for a given effectiveFrom. One row per
 * (user, mealType, effectiveFrom), enforced by uq_meal_targets_user_meal_effective
 * with the same retry-once concurrency handling as createTarget.
 */
export async function upsertMealTarget(
  userId: string,
  data: UpsertMealTargetInput & { effectiveFrom: string },
): Promise<MealTarget> {
  return retryOnceOnUniqueViolation("uq_meal_targets_user_meal_effective", () =>
    replaceMealTargetVersion(userId, data),
  );
}


export async function replaceMealTargetVersion(
  userId: string,
  data: UpsertMealTargetInput & { effectiveFrom: string },
): Promise<MealTarget> {
  return db.transaction(async (tx) => {
    await tx
      .delete(mealTargets)
      .where(
        and(
          eq(mealTargets.userId, userId),
          eq(mealTargets.mealType, data.mealType),
          eq(mealTargets.effectiveFrom, data.effectiveFrom),
        ),
      );
    const [row] = await tx
      .insert(mealTargets)
      .values({
        userId,
        mealType: data.mealType,
        calories: data.calories ?? null,
        proteinG: data.proteinG ?? null,
        carbG: data.carbG ?? null,
        fatG: data.fatG ?? null,
        effectiveFrom: data.effectiveFrom,
      })
      .returning();
    return row;
  });
}


/** Clear a meal's override entirely (revert that meal to the computed target). */
export async function deleteMealTarget(userId: string, mealType: MealType): Promise<void> {
  await db
    .delete(mealTargets)
    .where(and(eq(mealTargets.userId, userId), eq(mealTargets.mealType, mealType)));
}
