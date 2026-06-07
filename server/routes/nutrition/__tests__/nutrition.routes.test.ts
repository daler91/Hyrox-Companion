import express, { Router } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError, ErrorCode } from "../../../errors";
import { clearRateLimitBuckets } from "../../../routeUtils";
import { lookupBarcode } from "../../../services/nutrition/barcode";
import { getFoodWithServings } from "../../../services/nutrition/foodDetail";
import { searchFoods } from "../../../services/nutrition/foodSearch";
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

vi.mock("../../../storage", () => ({
  storage: {
    users: { getUser: vi.fn() },
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
      listEntriesWithFoodForDate: vi.fn(),
      updateLogEntry: vi.fn(),
      deleteLogEntry: vi.fn(),
      repeatDay: vi.fn(),
      createRecipe: vi.fn(),
      updateRecipe: vi.fn(),
      deleteRecipe: vi.fn(),
      listRecipes: vi.fn(),
      getRecipeWithIngredients: vi.fn(),
    },
  },
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

    it("adds (owner-scoped) and removes a serving", async () => {
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

  describe("feature flag gate", () => {
    it("404s every route when the flag is off", async () => {
      const gatedApp = createTestApp(nutritionIndexRouter);
      expect((await request(gatedApp).get("/api/v1/nutrition/foods/recent")).status).toBe(404);
      expect((await request(gatedApp).post("/api/v1/nutrition/logs").send({})).status).toBe(404);
      expect((await request(gatedApp).post("/api/v1/nutrition/foods/barcode").send({ code: "3017620422003" })).status).toBe(404);
    });
  });
});
