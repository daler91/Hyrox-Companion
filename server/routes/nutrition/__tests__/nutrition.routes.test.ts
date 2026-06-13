import express, { Router } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError, ErrorCode } from "../../../errors";
import { clearRateLimitBuckets } from "../../../routeUtils";
import { regenerateAndStoreNutritionInsights } from "../../../services/analyticsPersistence";
import { lookupBarcode } from "../../../services/nutrition/barcode";
import { getFoodWithServings } from "../../../services/nutrition/foodDetail";
import { searchFoods } from "../../../services/nutrition/foodSearch";
import { parseMealFromPhoto, parseMealFromText, resolveAndPreview } from "../../../services/nutrition/mealParser";
import { storage } from "../../../storage";
import { createTestApp } from "../../__tests__/testUtils";
import nutritionIndexRouter from "../index";
import { registerNutritionRoutes } from "../nutrition.routes";

vi.mock("../../../clerkAuth", () => ({
  isAuthenticated: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.auth = { userId: "test_user" };
    next();
  },
}));

vi.mock("../../../types", () => ({ getUserId: () => "test_user" }));

vi.mock("../../../services/nutrition/foodSearch", () => ({ searchFoods: vi.fn() }));
vi.mock("../../../services/nutrition/foodDetail", () => ({ getFoodWithServings: vi.fn() }));
vi.mock("../../../services/nutrition/barcode", () => ({ lookupBarcode: vi.fn() }));
vi.mock("../../../services/nutrition/mealParser", () => ({
  parseMealFromText: vi.fn(),
  parseMealFromPhoto: vi.fn(),
  resolveAndPreview: vi.fn(),
}));
// AI consent/budget gates are exercised in ai.test.ts; here they pass through so
// the Phase 4 parse route's own logic is what's under test.
vi.mock("../../../middleware/aiConsent", () => ({
  aiConsentCheck: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../../middleware/aibudget", () => ({
  aiBudgetCheck: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../../../storage", () => ({
  storage: {
    users: { getUser: vi.fn() },
    workouts: { getWorkoutLog: vi.fn() },
    analytics: {
      getWorkoutLogsByDateRange: vi.fn(),
      getAllExerciseSetsWithDates: vi.fn(),
      getExerciseLoadTags: vi.fn(),
    },
    analyticsResults: { get: vi.fn() },
    nutrition: {
      getVisibleFoodById: vi.fn(),
      getRecentFoods: vi.fn(),
      listCustomFoods: vi.fn(),
      createCustomFood: vi.fn(),
      updateCustomFood: vi.fn(),
      deleteCustomFood: vi.fn(),
      createServing: vi.fn(),
      deleteServing: vi.fn(),
      listFavorites: vi.fn(),
      addFavorite: vi.fn(),
      removeFavorite: vi.fn(),
      createLogEntry: vi.fn(),
      createLogEntriesBatch: vi.fn(),
      getVisibleFoodsByIds: vi.fn(),
      listEntriesWithFoodForDate: vi.fn(),
      listEntriesWithFoodInWindow: vi.fn(),
      listEntriesWithFoodForDateRange: vi.fn(),
      updateLogEntry: vi.fn(),
      deleteLogEntry: vi.fn(),
      repeatDay: vi.fn(),
      createRecipe: vi.fn(),
      updateRecipe: vi.fn(),
      deleteRecipe: vi.fn(),
      listRecipes: vi.fn(),
      getRecipeWithIngredients: vi.fn(),
      getCurrentTarget: vi.fn(),
      listTargets: vi.fn(),
      createTarget: vi.fn(),
      getLatestLogDate: vi.fn(),
    },
  },
}));

vi.mock("../../../services/analyticsPersistence", () => ({
  computeStale: vi.fn(() => false),
  regenerateAndStoreNutritionInsights: vi.fn(),
}));

function buildApp(): express.Express {
  const router = Router();
  registerNutritionRoutes(router);
  return createTestApp(router);
}

describe("nutrition routes", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    clearRateLimitBuckets();
    app = buildApp();
    // Chicago is UTC-5 in June, so an 02:30Z instant is the previous local day.
    vi.mocked(storage.users.getUser).mockResolvedValue({ userTimezone: "America/Chicago" });
  });

  describe("POST /logs", () => {
    it("computes logDate server-side from the user's timezone", async () => {
      vi.mocked(storage.nutrition.getVisibleFoodById).mockResolvedValue({ id: "food1" });
      vi.mocked(storage.nutrition.createLogEntry).mockResolvedValue({ id: "entry1" });

      const res = await request(app).post("/api/v1/nutrition/logs").send({
        foodId: "food1",
        quantityG: 150,
        mealType: "lunch",
        loggedAt: "2026-06-07T02:30:00Z",
      });

      expect(res.status).toBe(201);
      expect(storage.nutrition.createLogEntry).toHaveBeenCalledWith(
        "test_user",
        expect.objectContaining({ foodId: "food1", quantityG: 150, mealType: "lunch", logDate: "2026-06-06" }),
      );
    });

    it("records entryMethod from the request (barcode)", async () => {
      vi.mocked(storage.nutrition.getVisibleFoodById).mockResolvedValue({ id: "food1" });
      vi.mocked(storage.nutrition.createLogEntry).mockResolvedValue({ id: "entry1" });
      await request(app).post("/api/v1/nutrition/logs").send({
        foodId: "food1",
        quantityG: 100,
        mealType: "snack",
        loggedAt: "2026-06-07T12:00:00Z",
        entryMethod: "barcode",
      });
      expect(storage.nutrition.createLogEntry).toHaveBeenCalledWith(
        "test_user",
        expect.objectContaining({ entryMethod: "barcode" }),
      );
    });

    it("404s when the food is not visible to the user", async () => {
      vi.mocked(storage.nutrition.getVisibleFoodById).mockResolvedValue(undefined);
      const res = await request(app).post("/api/v1/nutrition/logs").send({
        foodId: "missing",
        quantityG: 100,
        mealType: "snack",
        loggedAt: "2026-06-07T12:00:00Z",
      });
      expect(res.status).toBe(404);
      expect(storage.nutrition.createLogEntry).not.toHaveBeenCalled();
    });

    it("400s on invalid input", async () => {
      const res = await request(app)
        .post("/api/v1/nutrition/logs")
        .send({ quantityG: -5, mealType: "lunch", loggedAt: "2026-06-07T12:00:00Z" });
      expect(res.status).toBe(400);
      expect(storage.nutrition.createLogEntry).not.toHaveBeenCalled();
    });
  });

  describe("GET /summary", () => {
    const row = {
      id: "e1",
      userId: "test_user",
      foodId: "f1",
      loggedAt: new Date("2026-06-07T08:00:00Z"),
      logDate: "2026-06-07",
      quantityG: 100,
      mealType: "breakfast",
      entryMethod: "manual",
      rawInput: null,
      parseConfidence: null,
      pendingReview: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      food: {
        id: "f1",
        source: "usda",
        sourceId: "1",
        name: "Banana",
        brand: null,
        servingSizeG: null,
        caloriesPer100g: 89,
        proteinPer100g: 1.1,
        carbPer100g: 23,
        fatPer100g: 0.3,
        fiberPer100g: 2.6,
        micros: null,
        createdByUserId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };

    it("returns totals + per-meal entries for a date", async () => {
      vi.mocked(storage.nutrition.listEntriesWithFoodForDate).mockResolvedValue([row]);
      const res = await request(app).get("/api/v1/nutrition/summary?date=2026-06-07");
      expect(res.status).toBe(200);
      expect(res.body.totals.calories).toBe(89);
      expect(res.body.meals.breakfast).toHaveLength(1);
    });

    it("400s on an invalid date", async () => {
      const res = await request(app).get("/api/v1/nutrition/summary?date=not-a-date");
      expect(res.status).toBe(400);
    });

    it("returns a null effectiveTarget when the user has no target", async () => {
      vi.mocked(storage.nutrition.listEntriesWithFoodForDate).mockResolvedValue([row]);
      const res = await request(app).get("/api/v1/nutrition/summary?date=2026-06-07");
      expect(res.status).toBe(200);
      expect(res.body.effectiveTarget).toBeNull();
      // No BMR profile either → no energy block, and no training-data reads.
      expect(res.body.energy).toBeNull();
      expect(storage.analytics.getWorkoutLogsByDateRange).not.toHaveBeenCalled();
    });

    it("includes the day's energy balance when the profile supports a BMR", async () => {
      vi.mocked(storage.nutrition.listEntriesWithFoodForDate).mockResolvedValue([row]);
      vi.mocked(storage.users.getUser).mockResolvedValue({
        userTimezone: "America/Chicago",
        bodyweightKg: 75,
        heightCm: 180,
        age: 30,
        gender: "male",
        activityLevel: "moderate",
      });
      vi.mocked(storage.analytics.getWorkoutLogsByDateRange).mockResolvedValue([
        { calories: 600 },
      ] as never);

      const res = await request(app).get("/api/v1/nutrition/summary?date=2026-06-07");

      expect(res.status).toBe(200);
      // BMR 1730 × 1.2 + 600 measured = 2676 out vs 89 kcal logged.
      expect(res.body.energy).toMatchObject({ basis: "measured", outKcal: 2676, inKcal: 89 });
    });

    it("returns a flat effective target without querying training load", async () => {
      vi.mocked(storage.nutrition.listEntriesWithFoodForDate).mockResolvedValue([row]);
      vi.mocked(storage.nutrition.getCurrentTarget).mockResolvedValue({
        id: "t1", userId: "test_user", calories: 2000, proteinG: 150, carbG: 200, fatG: 60,
        periodizationEnabled: false, referenceUtss: null, carbGramsPerUtss: null, effectiveFrom: "2026-06-01",
      });
      const res = await request(app).get("/api/v1/nutrition/summary?date=2026-06-07");
      expect(res.status).toBe(200);
      expect(res.body.effectiveTarget).toMatchObject({ carbG: 200, carbDeltaG: 0, scaled: false });
      expect(storage.analytics.getWorkoutLogsByDateRange).not.toHaveBeenCalled();
    });

    it("scales a periodised target using the day's training load (1-day window)", async () => {
      vi.mocked(storage.nutrition.listEntriesWithFoodForDate).mockResolvedValue([row]);
      vi.mocked(storage.nutrition.getCurrentTarget).mockResolvedValue({
        id: "t1", userId: "test_user", calories: 2000, proteinG: 150, carbG: 200, fatG: 60,
        periodizationEnabled: true, referenceUtss: 0, carbGramsPerUtss: 1, effectiveFrom: "2026-06-01",
      });
      vi.mocked(storage.analytics.getWorkoutLogsByDateRange).mockResolvedValue([]);
      vi.mocked(storage.analytics.getAllExerciseSetsWithDates).mockResolvedValue([]);
      vi.mocked(storage.analytics.getExerciseLoadTags).mockResolvedValue([]);
      const res = await request(app).get("/api/v1/nutrition/summary?date=2026-06-07");
      expect(res.status).toBe(200);
      // No logged workouts ⇒ UTSS 0; the scaling path still runs (scaled: true).
      expect(res.body.effectiveTarget).toMatchObject({ scaled: true, utss: 0, carbDeltaG: 0, carbG: 200 });
      expect(storage.analytics.getWorkoutLogsByDateRange).toHaveBeenCalledWith(
        "test_user",
        "2026-06-07",
        "2026-06-07",
      );
    });
  });

  describe("search / recent / favorites", () => {
    it("passes the userId to searchFoods and surfaces apiDegraded", async () => {
      vi.mocked(searchFoods).mockResolvedValue({ results: [{ id: "f1" }], apiDegraded: true });
      const res = await request(app).get("/api/v1/nutrition/foods/search?q=banana");
      expect(res.status).toBe(200);
      expect(res.body.apiDegraded).toBe(true);
      expect(searchFoods).toHaveBeenCalledWith("banana", "test_user");
    });

    it("adds a favorite only for a visible food", async () => {
      vi.mocked(storage.nutrition.getVisibleFoodById).mockResolvedValue({ id: "f1" });
      vi.mocked(storage.nutrition.addFavorite).mockResolvedValue({ id: "fav1" });
      expect((await request(app).post("/api/v1/nutrition/favorites").send({ foodId: "f1" })).status).toBe(201);

      vi.mocked(storage.nutrition.getVisibleFoodById).mockResolvedValue(undefined);
      expect((await request(app).post("/api/v1/nutrition/favorites").send({ foodId: "x" })).status).toBe(404);
    });
  });

  describe("barcode (FR-2.1)", () => {
    it("resolves a barcode, 404 unknown, 400 bad code", async () => {
      vi.mocked(lookupBarcode).mockResolvedValue({ id: "f1" });
      expect((await request(app).post("/api/v1/nutrition/foods/barcode").send({ code: "3017620422003" })).status).toBe(200);

      vi.mocked(lookupBarcode).mockResolvedValue(null);
      expect((await request(app).post("/api/v1/nutrition/foods/barcode").send({ code: "3017620422003" })).status).toBe(404);

      expect((await request(app).post("/api/v1/nutrition/foods/barcode").send({ code: "abc" })).status).toBe(400);
    });
  });

  describe("custom foods (FR-2.2)", () => {
    it("creates / lists / updates custom foods", async () => {
      vi.mocked(storage.nutrition.createCustomFood).mockResolvedValue({ id: "c1" });
      expect((await request(app).post("/api/v1/nutrition/foods").send({ name: "My Food" })).status).toBe(201);

      vi.mocked(storage.nutrition.listCustomFoods).mockResolvedValue([{ id: "c1" }]);
      const list = await request(app).get("/api/v1/nutrition/foods/custom");
      expect(list.body).toHaveLength(1);

      vi.mocked(storage.nutrition.updateCustomFood).mockResolvedValue({ id: "c1" });
      expect((await request(app).patch("/api/v1/nutrition/foods/c1").send({ name: "Renamed" })).status).toBe(200);
      vi.mocked(storage.nutrition.updateCustomFood).mockResolvedValue(undefined);
      expect((await request(app).patch("/api/v1/nutrition/foods/x").send({ name: "Renamed" })).status).toBe(404);
    });

    it("deletes a custom food, 404 missing, 409 when referenced", async () => {
      vi.mocked(storage.nutrition.deleteCustomFood).mockResolvedValue(true);
      expect((await request(app).delete("/api/v1/nutrition/foods/c1")).status).toBe(200);

      vi.mocked(storage.nutrition.deleteCustomFood).mockResolvedValue(false);
      expect((await request(app).delete("/api/v1/nutrition/foods/x")).status).toBe(404);

      vi.mocked(storage.nutrition.deleteCustomFood).mockRejectedValue(
        new AppError(ErrorCode.CONFLICT, "referenced", 409),
      );
      expect((await request(app).delete("/api/v1/nutrition/foods/c1")).status).toBe(409);
    });

    it("does not let /foods/:id swallow /foods/custom", async () => {
      vi.mocked(storage.nutrition.listCustomFoods).mockResolvedValue([]);
      const res = await request(app).get("/api/v1/nutrition/foods/custom");
      expect(res.status).toBe(200);
      expect(storage.nutrition.listCustomFoods).toHaveBeenCalled();
      expect(getFoodWithServings).not.toHaveBeenCalled();
    });
  });

  describe("food detail + servings (FR-2.4)", () => {
    it("returns a food with servings, 404 if not visible", async () => {
      vi.mocked(getFoodWithServings).mockResolvedValue({ food: { id: "f1" }, servings: [] });
      const ok = await request(app).get("/api/v1/nutrition/foods/f1");
      expect(ok.status).toBe(200);
      expect(ok.body.food.id).toBe("f1");

      vi.mocked(getFoodWithServings).mockResolvedValue(null);
      expect((await request(app).get("/api/v1/nutrition/foods/missing")).status).toBe(404);
    });

    it("adds a personal portion to a visible food and removes a serving", async () => {
      vi.mocked(storage.nutrition.createServing).mockResolvedValue({ id: "s1" });
      expect((await request(app).post("/api/v1/nutrition/foods/c1/servings").send({ label: "1 cup", grams: 240 })).status).toBe(201);

      vi.mocked(storage.nutrition.createServing).mockResolvedValue(undefined);
      expect((await request(app).post("/api/v1/nutrition/foods/x/servings").send({ label: "1 cup", grams: 240 })).status).toBe(404);

      vi.mocked(storage.nutrition.deleteServing).mockResolvedValue(true);
      expect((await request(app).delete("/api/v1/nutrition/foods/c1/servings/s1")).status).toBe(200);
    });
  });

  describe("recipes (FR-2.3)", () => {
    const recipeView = {
      id: "r1",
      name: "Bowl",
      servings: 2,
      foodId: "bf",
      totalGrams: 300,
      perServing: { calories: 100, protein: 5, carb: 10, fat: 2, fiber: 1 },
      ingredients: [],
    };

    it("creates and returns the computed recipe", async () => {
      vi.mocked(storage.nutrition.createRecipe).mockResolvedValue({ id: "r1" });
      vi.mocked(storage.nutrition.getRecipeWithIngredients).mockResolvedValue(recipeView);
      const res = await request(app).post("/api/v1/nutrition/recipes").send({
        name: "Bowl",
        servings: 2,
        ingredients: [{ foodId: "f1", quantityG: 150 }],
      });
      expect(res.status).toBe(201);
      expect(res.body.id).toBe("r1");
    });

    it("400s a recipe with an unknown ingredient", async () => {
      vi.mocked(storage.nutrition.createRecipe).mockRejectedValue(
        new AppError(ErrorCode.VALIDATION_ERROR, "ingredient not found", 400),
      );
      const res = await request(app).post("/api/v1/nutrition/recipes").send({
        name: "X",
        servings: 1,
        ingredients: [{ foodId: "missing", quantityG: 100 }],
      });
      expect(res.status).toBe(400);
    });

    it("lists, gets (404 missing), and deletes recipes", async () => {
      vi.mocked(storage.nutrition.listRecipes).mockResolvedValue([{ id: "r1", name: "Bowl", servings: 2, foodId: "bf" }]);
      expect((await request(app).get("/api/v1/nutrition/recipes")).body).toHaveLength(1);

      vi.mocked(storage.nutrition.getRecipeWithIngredients).mockResolvedValue(recipeView);
      expect((await request(app).get("/api/v1/nutrition/recipes/r1")).status).toBe(200);

      vi.mocked(storage.nutrition.getRecipeWithIngredients).mockResolvedValue(null);
      expect((await request(app).get("/api/v1/nutrition/recipes/missing")).status).toBe(404);

      vi.mocked(storage.nutrition.deleteRecipe).mockResolvedValue(true);
      expect((await request(app).delete("/api/v1/nutrition/recipes/r1")).status).toBe(200);
    });
  });

  describe("Phase 3: session-fuelling (FR-3.1/3.2/3.4)", () => {
    const food = {
      id: "f1", source: "usda", sourceId: "1", name: "Banana", brand: null,
      servingSizeG: null, caloriesPer100g: 100, proteinPer100g: 10, carbPer100g: 20,
      fatPer100g: 5, fiberPer100g: 2, micros: null, createdByUserId: null,
      createdAt: new Date(), updatedAt: new Date(),
    };
    const makeRow = (over: Record<string, unknown>) => ({
      id: "e1", userId: "test_user", foodId: "f1",
      loggedAt: new Date("2026-06-07T11:00:00Z"), logDate: "2026-06-07",
      quantityG: 100, mealType: "snack", entryMethod: "manual",
      rawInput: null, parseConfidence: null, pendingReview: false,
      createdAt: new Date(), updatedAt: new Date(), food, ...over,
    });

    it("404s for an unknown workout", async () => {
      vi.mocked(storage.workouts.getWorkoutLog).mockResolvedValue(undefined);
      expect((await request(app).get("/api/v1/nutrition/session-fuelling/missing")).status).toBe(404);
    });

    it("windows entries around a known start instant (usedStartTime true)", async () => {
      const startedAt = new Date("2026-06-07T12:00:00Z");
      vi.mocked(storage.workouts.getWorkoutLog).mockResolvedValue({ id: "w1", date: "2026-06-07", startedAt });
      vi.mocked(storage.nutrition.listEntriesWithFoodInWindow).mockResolvedValue([
        makeRow({ id: "pre", loggedAt: new Date("2026-06-07T11:00:00Z") }),
        makeRow({ id: "post", loggedAt: new Date("2026-06-07T13:00:00Z") }),
      ]);

      const res = await request(app).get("/api/v1/nutrition/session-fuelling/w1");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ workoutId: "w1", date: "2026-06-07", usedStartTime: true });
      expect(res.body.pre).toHaveLength(1);
      expect(res.body.post).toHaveLength(1);
      // 4h pre / 6h post windows around the captured start instant.
      expect(storage.nutrition.listEntriesWithFoodInWindow).toHaveBeenCalledWith(
        "test_user",
        new Date(startedAt.getTime() - 4 * 60 * 60 * 1000),
        new Date(startedAt.getTime() + 6 * 60 * 60 * 1000),
      );
      expect(storage.nutrition.listEntriesWithFoodForDate).not.toHaveBeenCalled();
    });

    it("falls back to the day's meal tags when startedAt is null (usedStartTime false)", async () => {
      vi.mocked(storage.workouts.getWorkoutLog).mockResolvedValue({ id: "w2", date: "2026-06-07", startedAt: null });
      vi.mocked(storage.nutrition.listEntriesWithFoodForDate).mockResolvedValue([
        makeRow({ id: "pre", mealType: "pre_workout" }),
        makeRow({ id: "post", mealType: "post_workout" }),
      ]);

      const res = await request(app).get("/api/v1/nutrition/session-fuelling/w2");
      expect(res.status).toBe(200);
      expect(res.body.usedStartTime).toBe(false);
      expect(res.body.pre).toHaveLength(1);
      expect(res.body.post).toHaveLength(1);
      expect(storage.nutrition.listEntriesWithFoodForDate).toHaveBeenCalledWith("test_user", "2026-06-07");
      expect(storage.nutrition.listEntriesWithFoodInWindow).not.toHaveBeenCalled();
    });
  });

  describe("Phase 3: block view (FR-3.3)", () => {
    beforeEach(() => {
      vi.mocked(storage.analytics.getWorkoutLogsByDateRange).mockResolvedValue([]);
      vi.mocked(storage.analytics.getAllExerciseSetsWithDates).mockResolvedValue([]);
      vi.mocked(storage.analytics.getExerciseLoadTags).mockResolvedValue([]);
      vi.mocked(storage.nutrition.listEntriesWithFoodForDateRange).mockResolvedValue([]);
      vi.mocked(storage.nutrition.listTargets).mockResolvedValue([]);
    });

    it("decorates points with the day's carb target, RPE and compliance (Roadmap G)", async () => {
      vi.mocked(storage.nutrition.listTargets).mockResolvedValue([
        {
          effectiveFrom: "2026-06-01", calories: 2000, proteinG: 150, carbG: 250, fatG: 60,
          periodizationEnabled: false, referenceUtss: null, carbGramsPerUtss: null,
        },
      ] as never);
      vi.mocked(storage.analytics.getWorkoutLogsByDateRange).mockResolvedValue([
        { date: "2026-06-02", rpe: 7, compliancePct: 84, duration: 60, focus: "Strength", mainWorkout: "5x5" },
      ] as never);

      const res = await request(app).get("/api/v1/nutrition/block?from=2026-06-01&to=2026-06-02");

      expect(res.status).toBe(200);
      const jun2 = res.body.points.find((p: { date: string }) => p.date === "2026-06-02");
      expect(jun2).toMatchObject({ carbTargetG: 250, avgRpe: 7, compliancePct: 84 });
      const jun1 = res.body.points.find((p: { date: string }) => p.date === "2026-06-01");
      expect(jun1).toMatchObject({ carbTargetG: 250, avgRpe: null, compliancePct: null });
    });

    it("merges intake and training load into zero-filled daily points", async () => {
      vi.mocked(storage.nutrition.listEntriesWithFoodForDateRange).mockResolvedValue([
        {
          id: "e1", userId: "test_user", foodId: "f1",
          loggedAt: new Date("2026-06-02T12:00:00Z"), logDate: "2026-06-02",
          quantityG: 100, mealType: "lunch", entryMethod: "manual",
          rawInput: null, parseConfidence: null, pendingReview: false,
          createdAt: new Date(), updatedAt: new Date(),
          food: {
            id: "f1", source: "usda", sourceId: "1", name: "Banana", brand: null,
            servingSizeG: null, caloriesPer100g: 100, proteinPer100g: 10, carbPer100g: 20,
            fatPer100g: 5, fiberPer100g: 2, micros: null, createdByUserId: null,
            createdAt: new Date(), updatedAt: new Date(),
          },
        },
      ]);

      const res = await request(app).get("/api/v1/nutrition/block?from=2026-06-01&to=2026-06-03");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ from: "2026-06-01", to: "2026-06-03" });
      expect(res.body.points).toHaveLength(3);
      const jun2 = res.body.points.find((p: { date: string }) => p.date === "2026-06-02");
      expect(jun2).toMatchObject({ calories: 100, protein: 10, utss: 0 });
      expect(storage.nutrition.listEntriesWithFoodForDateRange).toHaveBeenCalledWith(
        "test_user", "2026-06-01", "2026-06-03",
      );
    });

    it("defaults `to` to the user's local today when omitted", async () => {
      const res = await request(app).get("/api/v1/nutrition/block?from=2026-06-01");
      expect(res.status).toBe(200);
      expect(res.body.from).toBe("2026-06-01");
      expect(res.body.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("400s on a missing or invalid from", async () => {
      expect((await request(app).get("/api/v1/nutrition/block")).status).toBe(400);
      expect((await request(app).get("/api/v1/nutrition/block?from=not-a-date")).status).toBe(400);
    });
  });

  describe("Phase 4: natural-language logging (FR-4.1)", () => {
    it("parses a meal description into reviewed suggestions", async () => {
      vi.mocked(parseMealFromText).mockResolvedValue({ items: [], warnings: ["assumed large eggs"] });
      vi.mocked(resolveAndPreview).mockResolvedValue({
        items: [
          {
            name: "egg, scrambled",
            quantityG: 100,
            displayAmount: "2 eggs",
            mealType: "breakfast",
            confidence: 92,
            foodId: "f1",
            food: { id: "f1" } as never,
            nutrition: { calories: 150, protein: 10, carb: 1, fat: 11, fiber: 0 },
          },
        ],
        warnings: ["assumed large eggs"],
      });

      const res = await request(app).post("/api/v1/nutrition/parse/text").send({ text: "2 eggs" });
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].foodId).toBe("f1");
      expect(res.body.rawInput).toBe("2 eggs");
      expect(parseMealFromText).toHaveBeenCalledWith("2 eggs", "test_user");
    });

    it("400s when the text is missing", async () => {
      expect((await request(app).post("/api/v1/nutrition/parse/text").send({})).status).toBe(400);
      expect(parseMealFromText).not.toHaveBeenCalled();
    });

    it("logs a reviewed batch, deriving logDate from the user's timezone", async () => {
      vi.mocked(storage.nutrition.getVisibleFoodsByIds).mockResolvedValue(
        new Map([
          ["f1", { id: "f1" }],
          ["f2", { id: "f2" }],
        ]) as never,
      );
      vi.mocked(storage.nutrition.createLogEntriesBatch).mockResolvedValue([
        { id: "e1" },
        { id: "e2" },
      ] as never);

      const res = await request(app).post("/api/v1/nutrition/logs/batch").send({
        entryMethod: "nl",
        rawInput: "2 eggs and toast",
        loggedAt: "2026-06-07T02:30:00Z", // Chicago (UTC-5 in June) → previous local day
        items: [
          { foodId: "f1", quantityG: 100, mealType: "breakfast", parseConfidence: 92 },
          { foodId: "f2", quantityG: 30, mealType: "breakfast" },
        ],
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ created: 2, logDate: "2026-06-06" });
      expect(storage.nutrition.createLogEntriesBatch).toHaveBeenCalledWith(
        "test_user",
        expect.objectContaining({ entryMethod: "nl", rawInput: "2 eggs and toast", logDate: "2026-06-06" }),
      );
    });

    it("404s a batch referencing a food not visible to the user", async () => {
      vi.mocked(storage.nutrition.getVisibleFoodsByIds).mockResolvedValue(new Map() as never);
      const res = await request(app).post("/api/v1/nutrition/logs/batch").send({
        entryMethod: "nl",
        loggedAt: "2026-06-07T12:00:00Z",
        items: [{ foodId: "ghost", quantityG: 100, mealType: "lunch" }],
      });
      expect(res.status).toBe(404);
      expect(storage.nutrition.createLogEntriesBatch).not.toHaveBeenCalled();
    });

    it("400s a batch with no items", async () => {
      const res = await request(app).post("/api/v1/nutrition/logs/batch").send({
        entryMethod: "nl",
        loggedAt: "2026-06-07T12:00:00Z",
        items: [],
      });
      expect(res.status).toBe(400);
    });
  });

  describe("Phase 5: targets (FR-5.2)", () => {
    it("returns the current target (for today) plus history", async () => {
      vi.mocked(storage.nutrition.getCurrentTarget).mockResolvedValue({ id: "t1", calories: 2000 } as never);
      vi.mocked(storage.nutrition.listTargets).mockResolvedValue([{ id: "t1" }, { id: "t0" }] as never);

      const res = await request(app).get("/api/v1/nutrition/targets");
      expect(res.status).toBe(200);
      expect(res.body.current).toMatchObject({ id: "t1", calories: 2000 });
      expect(res.body.history).toHaveLength(2);
    });

    it("creates a target, defaulting effectiveFrom to the user's local today", async () => {
      vi.mocked(storage.nutrition.createTarget).mockResolvedValue({ id: "t1" } as never);
      const res = await request(app)
        .post("/api/v1/nutrition/targets")
        .send({ calories: 2200, proteinG: 160 });

      expect(res.status).toBe(201);
      expect(storage.nutrition.createTarget).toHaveBeenCalledWith(
        "test_user",
        expect.objectContaining({ calories: 2200, proteinG: 160, effectiveFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }),
      );
    });

    it("400s when no target field is set", async () => {
      const res = await request(app).post("/api/v1/nutrition/targets").send({});
      expect(res.status).toBe(400);
      expect(storage.nutrition.createTarget).not.toHaveBeenCalled();
    });
  });

  describe("Phase 5: micros (FR-5.1)", () => {
    it("returns the day's micronutrient summary vs RDI", async () => {
      vi.mocked(storage.nutrition.listEntriesWithFoodForDate).mockResolvedValue([
        {
          id: "e1", userId: "test_user", foodId: "f1",
          loggedAt: new Date("2026-06-07T08:00:00Z"), logDate: "2026-06-07",
          quantityG: 200, mealType: "breakfast", entryMethod: "manual",
          rawInput: null, parseConfidence: null, pendingReview: false,
          createdAt: new Date(), updatedAt: new Date(),
          food: {
            id: "f1", source: "usda", sourceId: "1", name: "Salty", brand: null,
            servingSizeG: null, caloriesPer100g: 100, proteinPer100g: 1, carbPer100g: 1,
            fatPer100g: 1, fiberPer100g: 0, micros: { sodium: 1000 }, createdByUserId: null,
            createdAt: new Date(), updatedAt: new Date(),
          },
        },
      ] as never);

      const res = await request(app).get("/api/v1/nutrition/micros?date=2026-06-07");
      expect(res.status).toBe(200);
      expect(res.body.date).toBe("2026-06-07");
      // 200g × 1000mg/100g = 2000mg sodium → 87% of the 2300mg RDI.
      expect(res.body.micros.find((m: { key: string }) => m.key === "sodium")).toMatchObject({
        amount: 2000,
        pctRdi: 87,
      });
    });
  });

  describe("Phase 5: AI insights (FR-5.3)", () => {
    it("returns insights:null when none have been generated", async () => {
      vi.mocked(storage.analyticsResults.get).mockResolvedValue(undefined);
      const res = await request(app).get("/api/v1/nutrition/insights");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ insights: null });
    });

    it("returns the stored analysis with generatedAt + stale flag", async () => {
      vi.mocked(storage.analyticsResults.get).mockResolvedValue({
        payload: { insights: "# Eat up", generatedAt: "2026-06-01T00:00:00.000Z" },
        generatedAt: new Date("2026-06-01T00:00:00.000Z"),
      } as never);
      vi.mocked(storage.nutrition.getLatestLogDate).mockResolvedValue("2026-06-07");

      const res = await request(app).get("/api/v1/nutrition/insights");
      expect(res.status).toBe(200);
      expect(res.body.insights).toBe("# Eat up");
      expect(res.body).toHaveProperty("stale");
    });

    it("regenerates on POST", async () => {
      vi.mocked(regenerateAndStoreNutritionInsights).mockResolvedValue({
        insights: "# Fresh",
        generatedAt: "2026-06-07T00:00:00.000Z",
      });
      const res = await request(app).post("/api/v1/nutrition/insights").send({});
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ insights: "# Fresh", stale: false });
      expect(regenerateAndStoreNutritionInsights).toHaveBeenCalledWith("test_user");
    });
  });

  describe("feature flag gate", () => {
    it("404s every route when the flag is off", async () => {
      const gatedApp = createTestApp(nutritionIndexRouter);
      expect((await request(gatedApp).get("/api/v1/nutrition/foods/recent")).status).toBe(404);
      expect((await request(gatedApp).post("/api/v1/nutrition/logs").send({})).status).toBe(404);
      expect((await request(gatedApp).post("/api/v1/nutrition/foods/barcode").send({ code: "3017620422003" })).status).toBe(404);
      expect((await request(gatedApp).get("/api/v1/nutrition/session-fuelling/w1")).status).toBe(404);
      expect((await request(gatedApp).get("/api/v1/nutrition/block?from=2026-06-01")).status).toBe(404);
      expect((await request(gatedApp).post("/api/v1/nutrition/parse/text").send({ text: "eggs" })).status).toBe(404);
      expect(
        (await request(gatedApp).post("/api/v1/nutrition/parse/photo").send({ imageBase64: "ZmFrZQ==", mimeType: "image/jpeg" })).status,
      ).toBe(404);
      expect((await request(gatedApp).post("/api/v1/nutrition/logs/batch").send({})).status).toBe(404);
      expect((await request(gatedApp).get("/api/v1/nutrition/targets")).status).toBe(404);
      expect((await request(gatedApp).post("/api/v1/nutrition/targets").send({ calories: 2000 })).status).toBe(404);
      expect((await request(gatedApp).get("/api/v1/nutrition/micros")).status).toBe(404);
      expect((await request(gatedApp).get("/api/v1/nutrition/insights")).status).toBe(404);
      expect((await request(gatedApp).post("/api/v1/nutrition/insights").send({})).status).toBe(404);
    });
  });
});

// Kept as a separate top-level suite (not nested in "nutrition routes") so the
// outer describe callback stays under the max-lines-per-function limit.
describe("nutrition photo meal parsing (FR-4.1)", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    clearRateLimitBuckets();
    app = buildApp();
  });

  it("parses a meal photo into reviewed suggestions", async () => {
    vi.mocked(parseMealFromPhoto).mockResolvedValue({ items: [], warnings: [] });
    vi.mocked(resolveAndPreview).mockResolvedValue({
      items: [
        {
          name: "egg, scrambled",
          quantityG: 100,
          displayAmount: "2 eggs",
          mealType: "breakfast",
          confidence: 88,
          foodId: "f1",
          food: { id: "f1" } as never,
          nutrition: { calories: 150, protein: 10, carb: 1, fat: 11, fiber: 0 },
        },
      ],
      warnings: [],
    });

    const res = await request(app)
      .post("/api/v1/nutrition/parse/photo")
      .send({ imageBase64: "ZmFrZS1pbWFnZQ==", mimeType: "image/jpeg" });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].foodId).toBe("f1");
    // No source text for a photo — rawInput is a short marker.
    expect(res.body.rawInput).toBe("[photo]");
    expect(parseMealFromPhoto).toHaveBeenCalledWith("ZmFrZS1pbWFnZQ==", "image/jpeg", "test_user");
  });

  it("400s a photo parse with an unsupported mimeType", async () => {
    const res = await request(app)
      .post("/api/v1/nutrition/parse/photo")
      .send({ imageBase64: "ZmFrZQ==", mimeType: "image/gif" });
    expect(res.status).toBe(400);
    expect(parseMealFromPhoto).not.toHaveBeenCalled();
  });

  it("400s a photo parse with a missing image", async () => {
    const res = await request(app).post("/api/v1/nutrition/parse/photo").send({ mimeType: "image/jpeg" });
    expect(res.status).toBe(400);
    expect(parseMealFromPhoto).not.toHaveBeenCalled();
  });
});
