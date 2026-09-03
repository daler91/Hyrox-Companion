/**
 * Recipes and the backing custom food each one keeps in sync (A8).
 *
 * Extracted from the single NutritionStorage class so each sub-domain is a
 * focused, separately-testable module; `nutrition.ts` keeps the class as the
 * storage facade's entry point, with every method name unchanged.
 */
import {
  type CreateRecipeInput,
  type Food,
  foodLogEntries,
  foods,
  type NutritionMacroTotals,
  type Recipe,
  recipeIngredients,
  type RecipeListItem,
  recipes,
  type RecipeWithIngredients,
} from "@shared/schema";
import {
  and,
  asc,
  count,
  eq,
} from "drizzle-orm";

import { db } from "../db";
import { AppError, ErrorCode } from "../errors";
import { computeRecipeFood } from "../services/nutrition/recipe";
import { roundMacros, scaleNutrition } from "../services/nutrition/rollup";
import { getVisibleFoodsByIds } from "./nutritionFoods";


// --- recipes (FR-2.3) -----------------------------------------------------

/** Resolve + validate ingredient foods, then compute the backing food's macros. */
export function computeFromInputs(input: CreateRecipeInput, foodsById: Map<string, Food>) {
  const withFoods = input.ingredients.map((ing) => {
    const food = foodsById.get(ing.foodId);
    if (!food) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        "One or more ingredient foods were not found",
        400,
      );
    }
    return { food, quantityG: ing.quantityG };
  });
  return computeRecipeFood(withFoods, input.servings);
}


export function backingFoodValues(
  userId: string,
  name: string,
  computed: ReturnType<typeof computeRecipeFood>,
) {
  return {
    source: "custom" as const,
    sourceId: null,
    name,
    brand: null,
    createdByUserId: userId,
    servingSizeG: computed.servingSizeG,
    caloriesPer100g: computed.caloriesPer100g,
    proteinPer100g: computed.proteinPer100g,
    carbPer100g: computed.carbPer100g,
    fatPer100g: computed.fatPer100g,
    fiberPer100g: computed.fiberPer100g,
    // Was omitted entirely, so a recipe of USDA-enriched ingredients logged as
    // carrying no micronutrients at all while the same ingredients logged
    // individually carried theirs (audit M21).
    micros: computed.micros,
  };
}


export async function createRecipe(userId: string, input: CreateRecipeInput): Promise<Recipe> {
  const foodsById = await getVisibleFoodsByIds(
    userId,
    input.ingredients.map((i) => i.foodId),
  );
  const computed = computeFromInputs(input, foodsById);

  return db.transaction(async (tx) => {
    const [backing] = await tx
      .insert(foods)
      .values(backingFoodValues(userId, input.name, computed))
      .returning();
    const [recipe] = await tx
      .insert(recipes)
      .values({ userId, foodId: backing.id, name: input.name, servings: input.servings })
      .returning();
    await tx.insert(recipeIngredients).values(
      input.ingredients.map((ing, idx) => ({
        recipeId: recipe.id,
        foodId: ing.foodId,
        quantityG: ing.quantityG,
        position: idx,
      })),
    );
    return recipe;
  });
}


export async function updateRecipe(
  userId: string,
  id: string,
  input: CreateRecipeInput,
): Promise<Recipe | undefined> {
  const [existing] = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.id, id), eq(recipes.userId, userId)));
  if (!existing) return undefined;
  // A recipe can't include its own backing food as an ingredient (self-loop).
  if (input.ingredients.some((i) => i.foodId === existing.foodId)) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      "A recipe can't include itself as an ingredient",
      400,
    );
  }

  const foodsById = await getVisibleFoodsByIds(
    userId,
    input.ingredients.map((i) => i.foodId),
  );
  const computed = computeFromInputs(input, foodsById);

  await db.transaction(async (tx) => {
    await tx
      .update(foods)
      .set({ ...backingFoodValues(userId, input.name, computed), updatedAt: new Date() })
      .where(eq(foods.id, existing.foodId));
    await tx.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, id));
    await tx.insert(recipeIngredients).values(
      input.ingredients.map((ing, idx) => ({
        recipeId: id,
        foodId: ing.foodId,
        quantityG: ing.quantityG,
        position: idx,
      })),
    );
    await tx
      .update(recipes)
      .set({ name: input.name, servings: input.servings, updatedAt: new Date() })
      .where(eq(recipes.id, id));
  });

  const [updated] = await db.select().from(recipes).where(eq(recipes.id, id));
  return updated;
}


/**
 * Delete a recipe + its ingredients. The backing food is deleted only if no log
 * entry references it (otherwise it's kept so logged history survives).
 */
export async function deleteRecipe(userId: string, id: string): Promise<boolean> {
  const [recipe] = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.id, id), eq(recipes.userId, userId)));
  if (!recipe) return false;

  await db.transaction(async (tx) => {
    await tx.delete(recipes).where(eq(recipes.id, id)); // cascades recipe_ingredients
    const [{ refs }] = await tx
      .select({ refs: count() })
      .from(foodLogEntries)
      .where(eq(foodLogEntries.foodId, recipe.foodId));
    if (refs === 0) {
      await tx.delete(foods).where(eq(foods.id, recipe.foodId));
    }
  });
  return true;
}


export async function listRecipes(userId: string): Promise<RecipeListItem[]> {
  return db
    .select({
      id: recipes.id,
      name: recipes.name,
      servings: recipes.servings,
      foodId: recipes.foodId,
    })
    .from(recipes)
    .where(eq(recipes.userId, userId))
    .orderBy(asc(recipes.name));
}


export async function getRecipeWithIngredients(
  userId: string,
  id: string,
): Promise<RecipeWithIngredients | null> {
  const [recipe] = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.id, id), eq(recipes.userId, userId)));
  if (!recipe) return null;

  const rows = await db
    .select({ ing: recipeIngredients, food: foods })
    .from(recipeIngredients)
    .innerJoin(foods, eq(recipeIngredients.foodId, foods.id))
    .where(eq(recipeIngredients.recipeId, id))
    .orderBy(asc(recipeIngredients.position));

  const totals: NutritionMacroTotals = { calories: 0, protein: 0, carb: 0, fat: 0, fiber: 0 };
  let totalGrams = 0;
  const ingredients = rows.map((r) => {
    const n = scaleNutrition(r.food, r.ing.quantityG);
    totals.calories += n.calories;
    totals.protein += n.protein;
    totals.carb += n.carb;
    totals.fat += n.fat;
    totals.fiber += n.fiber;
    totalGrams += r.ing.quantityG;
    return {
      id: r.ing.id,
      foodId: r.ing.foodId,
      name: r.food.name,
      brand: r.food.brand,
      quantityG: r.ing.quantityG,
      position: r.ing.position,
      nutrition: roundMacros(n),
    };
  });

  const divisor = recipe.servings > 0 ? recipe.servings : 1;
  const perServing = roundMacros({
    calories: totals.calories / divisor,
    protein: totals.protein / divisor,
    carb: totals.carb / divisor,
    fat: totals.fat / divisor,
    fiber: totals.fiber / divisor,
  });

  return {
    id: recipe.id,
    name: recipe.name,
    servings: recipe.servings,
    foodId: recipe.foodId,
    totalGrams,
    perServing,
    ingredients,
  };
}
