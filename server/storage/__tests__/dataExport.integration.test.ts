import {
  foodFavorites,
  foodServings,
  planDays,
  recipeIngredients,
  recipes,
  trainingPlans,
  userConsents,
  weeklyReviews,
} from "@shared/schema";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db";
import { storage } from "../index";
import {
  resetIntegrationDb,
  seedCustomFood,
  seedExerciseSet,
  seedFoodLogEntry,
  seedUser,
  seedWorkoutLog,
} from "./integrationDb";

/**
 * The GDPR export's reads against the REAL schema (P7, CODEBASE_ANALYSIS_2026-10-03):
 * each must return the athlete's rows in full and nobody else's, including the
 * ones the old hand-picked export never reached (a plan day that was never
 * scheduled, the nutrition diary, the weekly intents, the consent record).
 */
describe("DataExportStorage (real Postgres)", () => {
  const ALICE = "export-alice";
  const BOB = "export-bob";

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(ALICE);
    await seedUser(BOB);
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  async function seedPlanWithUnscheduledDay(userId: string) {
    const [plan] = await db
      .insert(trainingPlans)
      .values({ userId, name: `${userId} imported plan`, totalWeeks: 1 })
      .returning();
    const [day] = await db
      .insert(planDays)
      .values({
        planId: plan.id,
        weekNumber: 1,
        dayName: "Monday",
        focus: "Threshold",
        mainWorkout: "5x1km",
        scheduledDate: null,
      })
      .returning();
    await seedExerciseSet({ planDayId: day.id, exerciseName: "running", category: "running", setNumber: 1 });
    return { plan, day };
  }

  it("returns every plan day, never-scheduled ones included, with its prescribed sets, for the owner only", async () => {
    const { day } = await seedPlanWithUnscheduledDay(ALICE);
    await seedPlanWithUnscheduledDay(BOB);

    const days = await storage.dataExport.listPlanDaysWithSets(ALICE);

    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ id: day.id, scheduledDate: null, focus: "Threshold" });
    expect(days[0].exerciseSets).toEqual([expect.objectContaining({ planDayId: day.id, exerciseName: "running" })]);
  });

  it("returns every logged set with its session date, for the owner only", async () => {
    const aliceLog = await seedWorkoutLog(ALICE, "2026-09-01");
    const bobLog = await seedWorkoutLog(BOB, "2026-09-01");
    await seedExerciseSet({ workoutLogId: aliceLog.id, exerciseName: "back_squat", category: "strength", setNumber: 1 });
    await seedExerciseSet({ workoutLogId: bobLog.id, exerciseName: "deadlift", category: "strength", setNumber: 1 });

    const sets = await storage.dataExport.listLoggedExerciseSets(ALICE);

    expect(sets).toEqual([
      expect.objectContaining({ workoutLogId: aliceLog.id, date: "2026-09-01", exerciseName: "back_squat" }),
    ]);
  });

  it("returns the athlete's nutrition rows with readable food names, and nobody else's", async () => {
    const oats = await seedCustomFood(ALICE, "Alice's oats");
    const bobRice = await seedCustomFood(BOB, "Bob's rice");
    await seedFoodLogEntry(ALICE, oats.id, "2026-09-02");
    await seedFoodLogEntry(BOB, bobRice.id, "2026-09-02");
    await db.insert(foodFavorites).values({ userId: ALICE, foodId: oats.id });
    await db.insert(foodServings).values({ foodId: oats.id, label: "1 bowl", grams: 80, createdByUserId: ALICE });
    const recipeFood = await seedCustomFood(ALICE, "Overnight oats");
    const [recipe] = await db
      .insert(recipes)
      .values({ userId: ALICE, foodId: recipeFood.id, name: "Overnight oats", servings: 2 })
      .returning();
    await db.insert(recipeIngredients).values({ recipeId: recipe.id, foodId: oats.id, quantityG: 80 });

    const nutrition = await storage.dataExport.listNutrition(ALICE);

    expect(nutrition.foodLog).toEqual([
      expect.objectContaining({ foodId: oats.id, food: { name: "Alice's oats", brand: null } }),
    ]);
    expect(nutrition.foodFavorites).toEqual([expect.objectContaining({ foodId: oats.id })]);
    expect(nutrition.customFoodServings).toEqual([expect.objectContaining({ label: "1 bowl" })]);
    expect(nutrition.recipes).toEqual([
      expect.objectContaining({
        id: recipe.id,
        ingredients: [expect.objectContaining({ foodId: oats.id, food: { name: "Alice's oats", brand: null } })],
      }),
    ]);
    expect(nutrition.customFoods.map((food) => food.name).sort()).toEqual(["Alice's oats", "Overnight oats"]);
  });

  it("returns the athlete's own user-keyed rows (weekly intents, consents), and nobody else's", async () => {
    await db.insert(weeklyReviews).values([
      { userId: ALICE, weekStart: "2026-09-07", intent: "Easy week" },
      { userId: BOB, weekStart: "2026-09-07", intent: "Bob's week" },
    ]);
    await db.insert(userConsents).values({ userId: ALICE, consentType: "ai_coach", granted: true });

    const rows = await storage.dataExport.listUserKeyedRows(ALICE);

    expect(rows.weeklyReviews).toEqual([expect.objectContaining({ intent: "Easy week" })]);
    expect(rows.consents).toEqual([expect.objectContaining({ consentType: "ai_coach", granted: true })]);
    expect(rows.workoutStreams).toEqual([]);
    expect(rows.maf).toEqual({ profile: [], testResults: [], workoutAnalysis: [] });
  });
});
