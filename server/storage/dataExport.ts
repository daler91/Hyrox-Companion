import {
  analyticsResults,
  exerciseSets,
  foodFavorites,
  foodLogEntries,
  foods,
  foodServings,
  mafProfile,
  mafTestResults,
  mafWorkoutAnalysis,
  mealTargets,
  nutritionTargets,
  planAdjustmentProposals,
  planDayMoves,
  planDays,
  recipeIngredients,
  recipes,
  recycleBinItems,
  trainingPlans,
  userConsents,
  userTrainingStyle,
  weeklyReviews,
  workoutLogs,
  workoutLogStreams,
} from "@shared/schema";
import { asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "../db";
import type { LoggedExerciseSetWithDate } from "./shared";

/**
 * Read side of the GDPR data export (Art. 15/20) for every user-owned row no
 * other storage method returns whole.
 *
 * The export used to be a hand-picked list of 13 reads, so each table added
 * after it dropped out silently: nutrition, the MAF tables, weekly reviews,
 * heart-rate streams, consents, proposals and more, plus every plan day the
 * timeline does not show (never scheduled, or after a retired plan's cutoff).
 * P7 (CODEBASE_ANALYSIS_2026-10-03). exportService.test.ts now sweeps the
 * schema so a new user-owned table fails CI until it is exported or excluded.
 *
 * Every read is scoped by userId in SQL, directly or through the plan or
 * recipe the row hangs off, and none is windowed or capped: an access copy
 * that stops at a page size is not a copy.
 */
export class DataExportStorage {
  /**
   * Every set the athlete logged, with its session's date. Unlike the
   * analytics read (queryExerciseSetsWithDates) this has no
   * MAX_WORKOUT_LOGS_PER_QUERY cap, which cut the export at the 5,000 most
   * recent sessions.
   */
  async listLoggedExerciseSets(userId: string): Promise<LoggedExerciseSetWithDate[]> {
    const rows = await db
      .select({
        set: exerciseSets,
        workoutLogId: workoutLogs.id,
        date: workoutLogs.date,
        timeOfDayMin: workoutLogs.timeOfDayMin,
      })
      .from(exerciseSets)
      .innerJoin(workoutLogs, eq(exerciseSets.workoutLogId, workoutLogs.id))
      .where(eq(workoutLogs.userId, userId))
      .orderBy(desc(workoutLogs.date), asc(workoutLogs.id), asc(exerciseSets.sortOrder), asc(exerciseSets.setNumber));
    return rows.map(({ set, workoutLogId, date, timeOfDayMin }) => ({ ...set, workoutLogId, date, timeOfDayMin }));
  }

  /**
   * Every day of every plan the athlete owns, each with its prescribed sets:
   * scheduled or not, live or retired. The timeline only carries scheduled days
   * inside a plan's lifetime, so an imported plan that was never scheduled was
   * missing from the export altogether.
   */
  async listPlanDaysWithSets(userId: string) {
    const ownedDayIds = db
      .select({ id: planDays.id })
      .from(planDays)
      .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
      .where(eq(trainingPlans.userId, userId));

    const [days, sets] = await Promise.all([
      db
        .select({ day: planDays })
        .from(planDays)
        .innerJoin(trainingPlans, eq(planDays.planId, trainingPlans.id))
        .where(eq(trainingPlans.userId, userId))
        .orderBy(asc(planDays.planId), asc(planDays.weekNumber), asc(planDays.scheduledDate)),
      db
        .select()
        .from(exerciseSets)
        .where(inArray(exerciseSets.planDayId, ownedDayIds))
        .orderBy(asc(exerciseSets.planDayId), asc(exerciseSets.sortOrder), asc(exerciseSets.setNumber)),
    ]);

    const setsByDay = new Map<string, (typeof sets)[number][]>();
    for (const set of sets) {
      if (!set.planDayId) continue;
      const daySets = setsByDay.get(set.planDayId) ?? [];
      daySets.push(set);
      setsByDay.set(set.planDayId, daySets);
    }
    return days.map(({ day }) => ({ ...day, exerciseSets: setsByDay.get(day.id) ?? [] }));
  }

  /** The nutrition module's rows: diary, targets, favourites, recipes and the athlete's own foods. */
  async listNutrition(userId: string) {
    const ownedRecipeIds = db.select({ id: recipes.id }).from(recipes).where(eq(recipes.userId, userId));
    const foodLabel = { name: foods.name, brand: foods.brand };

    const [logEntries, targets, perMealTargets, favorites, ownRecipes, ingredients, customFoods, customServings] =
      await Promise.all([
        db
          .select({ entry: foodLogEntries, food: foodLabel })
          .from(foodLogEntries)
          .innerJoin(foods, eq(foodLogEntries.foodId, foods.id))
          .where(eq(foodLogEntries.userId, userId))
          .orderBy(asc(foodLogEntries.logDate), asc(foodLogEntries.loggedAt)),
        db
          .select()
          .from(nutritionTargets)
          .where(eq(nutritionTargets.userId, userId))
          .orderBy(asc(nutritionTargets.effectiveFrom)),
        db.select().from(mealTargets).where(eq(mealTargets.userId, userId)).orderBy(asc(mealTargets.effectiveFrom)),
        db
          .select({ favorite: foodFavorites, food: foodLabel })
          .from(foodFavorites)
          .innerJoin(foods, eq(foodFavorites.foodId, foods.id))
          .where(eq(foodFavorites.userId, userId)),
        db.select().from(recipes).where(eq(recipes.userId, userId)).orderBy(asc(recipes.createdAt)),
        db
          .select({ ingredient: recipeIngredients, food: foodLabel })
          .from(recipeIngredients)
          .innerJoin(foods, eq(recipeIngredients.foodId, foods.id))
          .where(inArray(recipeIngredients.recipeId, ownedRecipeIds))
          .orderBy(asc(recipeIngredients.recipeId), asc(recipeIngredients.position)),
        // Public ones too: the athlete created them, and sharing does not make them less theirs.
        db.select().from(foods).where(eq(foods.createdByUserId, userId)).orderBy(asc(foods.createdAt)),
        db.select().from(foodServings).where(eq(foodServings.createdByUserId, userId)),
      ]);

    return {
      foodLog: logEntries.map(({ entry, food }) => ({ ...entry, food })),
      nutritionTargets: targets,
      mealTargets: perMealTargets,
      foodFavorites: favorites.map(({ favorite, food }) => ({ ...favorite, food })),
      recipes: ownRecipes.map((recipe) => ({
        ...recipe,
        ingredients: ingredients
          .filter(({ ingredient }) => ingredient.recipeId === recipe.id)
          .map(({ ingredient, food }) => ({ ...ingredient, food })),
      })),
      customFoods,
      customFoodServings: customServings,
    };
  }

  /** Every remaining table keyed directly by users.id, row for row. */
  async listUserKeyedRows(userId: string) {
    const [
      weeklyReviewRows,
      streams,
      moves,
      proposals,
      consents,
      trainingStyleHistory,
      analytics,
      mafProfileRows,
      mafTests,
      mafAnalyses,
      recycleBin,
    ] = await Promise.all([
      db.select().from(weeklyReviews).where(eq(weeklyReviews.userId, userId)).orderBy(asc(weeklyReviews.weekStart)),
      // Per-session heart-rate/pace series: health data, exported in full.
      db
        .select()
        .from(workoutLogStreams)
        .where(eq(workoutLogStreams.userId, userId))
        .orderBy(asc(workoutLogStreams.createdAt)),
      db.select().from(planDayMoves).where(eq(planDayMoves.userId, userId)).orderBy(asc(planDayMoves.movedAt)),
      db
        .select()
        .from(planAdjustmentProposals)
        .where(eq(planAdjustmentProposals.userId, userId))
        .orderBy(asc(planAdjustmentProposals.createdAt)),
      db.select().from(userConsents).where(eq(userConsents.userId, userId)).orderBy(asc(userConsents.consentedAt)),
      db
        .select()
        .from(userTrainingStyle)
        .where(eq(userTrainingStyle.userId, userId))
        .orderBy(asc(userTrainingStyle.effectiveDate)),
      // Stored AI narratives about the athlete (Coach Insights, race prediction).
      db.select().from(analyticsResults).where(eq(analyticsResults.userId, userId)),
      db.select().from(mafProfile).where(eq(mafProfile.userId, userId)).orderBy(asc(mafProfile.createdAt)),
      db.select().from(mafTestResults).where(eq(mafTestResults.userId, userId)).orderBy(asc(mafTestResults.createdAt)),
      db
        .select()
        .from(mafWorkoutAnalysis)
        .where(eq(mafWorkoutAnalysis.userId, userId))
        .orderBy(asc(mafWorkoutAnalysis.createdAt)),
      // Deleted records the service still holds until they expire.
      db
        .select()
        .from(recycleBinItems)
        .where(eq(recycleBinItems.userId, userId))
        .orderBy(asc(recycleBinItems.deletedAt)),
    ]);

    return {
      weeklyReviews: weeklyReviewRows,
      workoutStreams: streams,
      planDayMoves: moves,
      planAdjustmentProposals: proposals,
      consents,
      trainingStyleHistory,
      analyticsResults: analytics,
      maf: { profile: mafProfileRows, testResults: mafTests, workoutAnalysis: mafAnalyses },
      recycleBin,
    };
  }
}
