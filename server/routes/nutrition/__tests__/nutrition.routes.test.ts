import express, { Router } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearRateLimitBuckets } from "../../../routeUtils";
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

vi.mock("../../../storage", () => ({
  storage: {
    users: { getUser: vi.fn() },
    nutrition: {
      getFoodById: vi.fn(),
      getRecentFoods: vi.fn(),
      listFavorites: vi.fn(),
      addFavorite: vi.fn(),
      removeFavorite: vi.fn(),
      createLogEntry: vi.fn(),
      listEntriesWithFoodForDate: vi.fn(),
      updateLogEntry: vi.fn(),
      deleteLogEntry: vi.fn(),
      repeatDay: vi.fn(),
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

  describe("POST /api/v1/nutrition/logs", () => {
    it("computes logDate server-side from the user's timezone", async () => {
      vi.mocked(storage.nutrition.getFoodById).mockResolvedValue({ id: "food1" });
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

    it("404s when the food does not exist", async () => {
      vi.mocked(storage.nutrition.getFoodById).mockResolvedValue(undefined);
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

  describe("GET /api/v1/nutrition/summary", () => {
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
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };

    it("returns totals + per-meal entries for a date", async () => {
      vi.mocked(storage.nutrition.listEntriesWithFoodForDate).mockResolvedValue([row]);
      const res = await request(app).get("/api/v1/nutrition/summary?date=2026-06-07");
      expect(res.status).toBe(200);
      expect(res.body.logDate).toBe("2026-06-07");
      expect(res.body.totals.calories).toBe(89);
      expect(res.body.meals.breakfast).toHaveLength(1);
      expect(storage.nutrition.listEntriesWithFoodForDate).toHaveBeenCalledWith("test_user", "2026-06-07");
    });

    it("defaults to today and returns zero totals for an empty day", async () => {
      vi.mocked(storage.nutrition.listEntriesWithFoodForDate).mockResolvedValue([]);
      const res = await request(app).get("/api/v1/nutrition/summary");
      expect(res.status).toBe(200);
      expect(res.body.totals.calories).toBe(0);
    });

    it("400s on an invalid date", async () => {
      const res = await request(app).get("/api/v1/nutrition/summary?date=not-a-date");
      expect(res.status).toBe(400);
    });
  });

  describe("PATCH/DELETE /api/v1/nutrition/logs/:id", () => {
    it("updates an entry", async () => {
      vi.mocked(storage.nutrition.updateLogEntry).mockResolvedValue({ id: "e1" });
      const res = await request(app).patch("/api/v1/nutrition/logs/e1").send({ quantityG: 200 });
      expect(res.status).toBe(200);
      expect(storage.nutrition.updateLogEntry).toHaveBeenCalledWith(
        "test_user",
        "e1",
        expect.objectContaining({ quantityG: 200 }),
      );
    });

    it("404s updating a missing entry", async () => {
      vi.mocked(storage.nutrition.updateLogEntry).mockResolvedValue(undefined);
      const res = await request(app).patch("/api/v1/nutrition/logs/x").send({ quantityG: 200 });
      expect(res.status).toBe(404);
    });

    it("deletes an entry, 404 when missing", async () => {
      vi.mocked(storage.nutrition.deleteLogEntry).mockResolvedValue(true);
      expect((await request(app).delete("/api/v1/nutrition/logs/e1")).status).toBe(200);
      vi.mocked(storage.nutrition.deleteLogEntry).mockResolvedValue(false);
      expect((await request(app).delete("/api/v1/nutrition/logs/x")).status).toBe(404);
    });
  });

  describe("search, recent, favorites, repeat", () => {
    it("returns search results and surfaces apiDegraded", async () => {
      vi.mocked(searchFoods).mockResolvedValue({ results: [{ id: "f1" }], apiDegraded: true });
      const res = await request(app).get("/api/v1/nutrition/foods/search?q=banana");
      expect(res.status).toBe(200);
      expect(res.body.apiDegraded).toBe(true);
      expect(searchFoods).toHaveBeenCalledWith("banana");
    });

    it("400s a too-short search query", async () => {
      const res = await request(app).get("/api/v1/nutrition/foods/search?q=a");
      expect(res.status).toBe(400);
      expect(searchFoods).not.toHaveBeenCalled();
    });

    it("lists recent foods", async () => {
      vi.mocked(storage.nutrition.getRecentFoods).mockResolvedValue([{ id: "f1" }]);
      const res = await request(app).get("/api/v1/nutrition/foods/recent");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it("adds a favorite when the food exists, 404 otherwise", async () => {
      vi.mocked(storage.nutrition.getFoodById).mockResolvedValue({ id: "f1" });
      vi.mocked(storage.nutrition.addFavorite).mockResolvedValue({ id: "fav1" });
      expect((await request(app).post("/api/v1/nutrition/favorites").send({ foodId: "f1" })).status).toBe(201);

      vi.mocked(storage.nutrition.getFoodById).mockResolvedValue(undefined);
      expect((await request(app).post("/api/v1/nutrition/favorites").send({ foodId: "x" })).status).toBe(404);
    });

    it("removes a favorite, 404 when not present", async () => {
      vi.mocked(storage.nutrition.removeFavorite).mockResolvedValue(true);
      expect((await request(app).delete("/api/v1/nutrition/favorites/f1")).status).toBe(200);
      vi.mocked(storage.nutrition.removeFavorite).mockResolvedValue(false);
      expect((await request(app).delete("/api/v1/nutrition/favorites/x")).status).toBe(404);
    });

    it("repeats a day, 404 when the source day is empty", async () => {
      vi.mocked(storage.nutrition.repeatDay).mockResolvedValue(3);
      const ok = await request(app).post("/api/v1/nutrition/logs/repeat").send({ sourceDate: "2026-06-06" });
      expect(ok.status).toBe(201);
      expect(ok.body.created).toBe(3);

      vi.mocked(storage.nutrition.repeatDay).mockResolvedValue(0);
      const empty = await request(app).post("/api/v1/nutrition/logs/repeat").send({ sourceDate: "2026-06-06" });
      expect(empty.status).toBe(404);
    });
  });

  describe("feature flag gate", () => {
    // NUTRITION_ENABLED is unset in the test env, so it defaults to "false" and
    // the whole surface must 404 (invisible-when-off), enforced server-side.
    it("404s every route when the flag is off", async () => {
      const gatedApp = createTestApp(nutritionIndexRouter);
      expect((await request(gatedApp).get("/api/v1/nutrition/foods/recent")).status).toBe(404);
      expect((await request(gatedApp).post("/api/v1/nutrition/logs").send({})).status).toBe(404);
    });
  });
});
