/**
 * Favourite foods (A8).
 *
 * Extracted from the single NutritionStorage class so each sub-domain is a
 * focused, separately-testable module; `nutrition.ts` keeps the class as the
 * storage facade's entry point, with every method name unchanged.
 */
import {
  type FoodFavorite,
  foodFavorites,
  foods,
  type FoodWithPortionMemory,
} from "@shared/schema";
import {
  and,
  desc,
  eq,
} from "drizzle-orm";

import { db } from "../db";
import { getLastPortions, visibleTo, withPortionMemory } from "./nutritionShared";


// --- favorites ------------------------------------------------------------

export async function listFavorites(userId: string): Promise<FoodWithPortionMemory[]> {
  const rows = await db
    .select({ food: foods })
    .from(foodFavorites)
    .innerJoin(foods, eq(foodFavorites.foodId, foods.id))
    .where(and(eq(foodFavorites.userId, userId), visibleTo(userId)))
    .orderBy(desc(foodFavorites.createdAt));

  const items = rows.map((r) => r.food);
  // A favourite can be starred without ever having been logged, so the
  // portion lookup is a left-join in spirit: missing entries stay null.
  const portions = await getLastPortions(userId, items.map((f) => f.id));
  return withPortionMemory(items, portions);
}


export async function addFavorite(userId: string, foodId: string): Promise<FoodFavorite | undefined> {
  const [row] = await db
    .insert(foodFavorites)
    .values({ userId, foodId })
    .onConflictDoNothing({ target: [foodFavorites.userId, foodFavorites.foodId] })
    .returning();
  return row;
}


export async function removeFavorite(userId: string, foodId: string): Promise<boolean> {
  const result = await db
    .delete(foodFavorites)
    .where(and(eq(foodFavorites.userId, userId), eq(foodFavorites.foodId, foodId)))
    .returning({ id: foodFavorites.id });
  return result.length > 0;
}
