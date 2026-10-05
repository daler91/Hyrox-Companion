/**
 * What account erasure does with the erased athlete's private custom foods,
 * inside UserStorage.deleteUserAndPrivateCustomFoods's transaction: delete
 * those nothing references any more, and hand those other athletes still
 * reference over to them.
 */
import { inSequence } from "@shared/inSequence";
import {
  foodFavorites,
  foodLogEntries,
  foods,
  foodServings,
  recipeIngredients,
  recipes,
} from "@shared/schema";
import { and, eq, inArray, notExists, sql } from "drizzle-orm";

import type { Tx } from "../db";

/** What a handed-over food is called once its erased creator's wording is gone (D53). */
export const ERASED_CUSTOM_FOOD_NAME = "Custom food (removed by its creator)";

/**
 * Delete those of `foodIds` nothing references any more, and return their ids.
 * Guarded on every RESTRICT FK into foods: an unguarded delete of a food
 * another athlete still references would abort the whole erasure, after the
 * Clerk identity is already gone.
 */
export async function deleteUnreferencedFoods(tx: Tx, foodIds: string[]): Promise<string[]> {
  if (foodIds.length === 0) return [];
  const rows = await tx
    .delete(foods)
    .where(
      and(
        inArray(foods.id, foodIds),
        notExists(
          tx
            .select({ one: sql`1` })
            .from(foodLogEntries)
            .where(eq(foodLogEntries.foodId, foods.id)),
        ),
        notExists(
          tx
            .select({ one: sql`1` })
            .from(recipeIngredients)
            .where(eq(recipeIngredients.foodId, foods.id)),
        ),
        notExists(
          tx
            .select({ one: sql`1` })
            .from(recipes)
            .where(eq(recipes.foodId, foods.id)),
        ),
      ),
    )
    .returning({ id: foods.id });
  return rows.map((row) => row.id);
}

/**
 * Hand an erased athlete's private custom foods that other athletes still
 * reference (shared, logged or put in a recipe, then unshared) over to those
 * athletes, and return the originals deleted. Each referencing athlete gets
 * their own private copy with the same nutrition under a neutral name; their
 * log entries, recipe lines, own portions and favourite move onto it, so their
 * history keeps every number while the erased athlete's wording goes. The
 * originals are then deleted, guarded as before: a row something still points
 * at (a reference that raced this) stays, but under the neutral name. D53
 * (CODEBASE_ANALYSIS_2026-10-03)
 */
export async function handReferencedFoodsToReferencers(
  tx: Tx,
  foodIds: string[],
): Promise<string[]> {
  if (foodIds.length === 0) return [];
  await tx
    .update(foods)
    .set({ name: ERASED_CUSTOM_FOOD_NAME, brand: null })
    .where(inArray(foods.id, foodIds));
  const originals = new Map(
    (await tx.select().from(foods).where(inArray(foods.id, foodIds))).map((food) => [
      food.id,
      food,
    ]),
  );
  // One after the other: both run on the transaction's single client.
  const loggers = await tx
    .selectDistinct({ foodId: foodLogEntries.foodId, userId: foodLogEntries.userId })
    .from(foodLogEntries)
    .where(inArray(foodLogEntries.foodId, foodIds));
  const recipeOwners = await tx
    .selectDistinct({ foodId: recipeIngredients.foodId, userId: recipes.userId })
    .from(recipeIngredients)
    .innerJoin(recipes, eq(recipes.id, recipeIngredients.recipeId))
    .where(inArray(recipeIngredients.foodId, foodIds));
  const referencers = new Map(
    [...loggers, ...recipeOwners].map((ref) => [JSON.stringify([ref.foodId, ref.userId]), ref]),
  );

  await inSequence([...referencers.values()], async ({ foodId, userId }) => {
    const original = originals.get(foodId);
    if (!original) return;
    const [copy] = await tx
      .insert(foods)
      .values({
        source: "custom",
        name: ERASED_CUSTOM_FOOD_NAME,
        servingSizeG: original.servingSizeG,
        caloriesPer100g: original.caloriesPer100g,
        proteinPer100g: original.proteinPer100g,
        carbPer100g: original.carbPer100g,
        fatPer100g: original.fatPer100g,
        fiberPer100g: original.fiberPer100g,
        micros: original.micros,
        createdByUserId: userId,
        isPublic: false,
      })
      .returning({ id: foods.id });
    await tx
      .update(foodLogEntries)
      .set({ foodId: copy.id, updatedAt: new Date() })
      .where(and(eq(foodLogEntries.foodId, foodId), eq(foodLogEntries.userId, userId)));
    await tx
      .update(recipeIngredients)
      .set({ foodId: copy.id })
      .where(
        and(
          eq(recipeIngredients.foodId, foodId),
          inArray(
            recipeIngredients.recipeId,
            tx.select({ id: recipes.id }).from(recipes).where(eq(recipes.userId, userId)),
          ),
        ),
      );
    await tx
      .update(foodServings)
      .set({ foodId: copy.id })
      .where(and(eq(foodServings.foodId, foodId), eq(foodServings.createdByUserId, userId)));
    await tx
      .update(foodFavorites)
      .set({ foodId: copy.id })
      .where(and(eq(foodFavorites.foodId, foodId), eq(foodFavorites.userId, userId)));
  });

  return await deleteUnreferencedFoods(tx, foodIds);
}
