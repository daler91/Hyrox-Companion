import {
  exerciseSets,
  foodFavorites,
  foodLogEntries,
  foods,
  foodServings,
  mealTargets,
  nutritionTargets,
  planDays,
  recipeIngredients,
  recipes,
  trainingPlans,
  users,
  workoutLogs,
} from "@shared/schema";
import { eq } from "drizzle-orm";

import { db } from "../../db";

/**
 * Shared scaffolding for the storage-layer integration suites
 * (server/storage/__tests__/*.integration.test.ts), which run the REAL Drizzle
 * SQL against the pgvector Postgres that cypress.yml provisions — the
 * mocked-db unit tests next door prove nothing about the SQL itself.
 *
 * Reset order is FK-safe: children before parents, and custom foods last,
 * because deleting a user only SET NULLs foods.created_by_user_id (the
 * deliberate FK choice documented on UserStorage.deleteUserAndPrivateCustomFoods).
 */
export async function resetIntegrationDb(): Promise<void> {
  await db.delete(foodLogEntries);
  await db.delete(recipeIngredients);
  await db.delete(recipes);
  await db.delete(foodFavorites);
  await db.delete(foodServings);
  await db.delete(mealTargets);
  await db.delete(nutritionTargets);
  await db.delete(exerciseSets);
  await db.delete(workoutLogs);
  await db.delete(planDays);
  await db.delete(trainingPlans);
  await db.delete(users);
  await db.delete(foods).where(eq(foods.source, "custom"));
}

export async function seedUser(
  id: string,
  overrides: { weightUnit?: string; distanceUnit?: string; email?: string } = {},
): Promise<string> {
  await db
    .insert(users)
    .values({
      id,
      email: overrides.email ?? `${id}@example.com`,
      weightUnit: overrides.weightUnit ?? "kg",
      distanceUnit: overrides.distanceUnit ?? "km",
    })
    .onConflictDoNothing();
  return id;
}

export async function seedWorkoutLog(
  userId: string,
  date: string,
  overrides: Partial<typeof workoutLogs.$inferInsert> = {},
): Promise<typeof workoutLogs.$inferSelect> {
  const [row] = await db
    .insert(workoutLogs)
    .values({ userId, date, focus: "Strength", mainWorkout: "5x5 Back Squat", ...overrides })
    .returning();
  return row;
}

export async function seedExerciseSet(
  values: typeof exerciseSets.$inferInsert,
): Promise<typeof exerciseSets.$inferSelect> {
  const [row] = await db.insert(exerciseSets).values(values).returning();
  return row;
}

export async function seedCustomFood(
  createdByUserId: string,
  name: string,
  overrides: Partial<typeof foods.$inferInsert> = {},
): Promise<typeof foods.$inferSelect> {
  const [row] = await db
    .insert(foods)
    .values({
      source: "custom",
      sourceId: null,
      name,
      createdByUserId,
      isPublic: false,
      caloriesPer100g: 100,
      proteinPer100g: 10,
      carbPer100g: 10,
      fatPer100g: 2,
      ...overrides,
    })
    .returning();
  return row;
}

export async function seedFoodLogEntry(
  userId: string,
  foodId: string,
  logDate: string,
  overrides: Partial<typeof foodLogEntries.$inferInsert> = {},
): Promise<typeof foodLogEntries.$inferSelect> {
  const [row] = await db
    .insert(foodLogEntries)
    .values({
      userId,
      foodId,
      logDate,
      loggedAt: new Date(`${logDate}T12:00:00Z`),
      quantityG: 100,
      mealType: "lunch",
      ...overrides,
    })
    .returning();
  return row;
}
