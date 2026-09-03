import { Router } from "express";
import { describe, expect, it } from "vitest";

import nutritionRouter from "../nutrition/index";
import { registerNutritionRoutes } from "../nutrition/nutrition.routes";

const BASE = "/api/v1/nutrition";

/**
 * Every endpoint on the nutrition surface, keyed by the sub-module that owns
 * it. The composer (nutrition.routes.ts) must register all of them; a module
 * that is dropped from the composer, or an endpoint that goes missing during a
 * move, fails the table check below.
 */
const EXPECTED_ROUTES: Record<string, ReadonlyArray<readonly [string, string]>> = {
  "nutritionFoods.routes": [
    ["get", `${BASE}/foods/search`],
    ["get", `${BASE}/foods/recent`],
    ["get", `${BASE}/foods/custom`],
    ["post", `${BASE}/foods/barcode`],
    ["post", `${BASE}/foods`],
    ["get", `${BASE}/foods/:id`],
    ["patch", `${BASE}/foods/:id`],
    ["delete", `${BASE}/foods/:id`],
    ["post", `${BASE}/foods/:id/servings`],
    ["delete", `${BASE}/foods/:id/servings/:servingId`],
  ],
  "nutritionFavorites.routes": [
    ["get", `${BASE}/favorites`],
    ["post", `${BASE}/favorites`],
    ["delete", `${BASE}/favorites/:foodId`],
  ],
  "nutritionLogs.routes": [
    ["post", `${BASE}/logs`],
    ["patch", `${BASE}/logs/:id`],
    ["delete", `${BASE}/logs/:id`],
    ["post", `${BASE}/logs/repeat`],
    ["post", `${BASE}/logs/batch`],
  ],
  "nutritionSummary.routes": [
    ["get", `${BASE}/summary`],
    ["get", `${BASE}/session-fuelling/:workoutId`],
    ["get", `${BASE}/planned-session-estimate/:planDayId`],
    ["get", `${BASE}/block`],
    ["get", `${BASE}/summary-range`],
  ],
  "nutritionParse.routes": [
    ["post", `${BASE}/parse/text`],
    ["post", `${BASE}/parse/photo`],
    ["post", `${BASE}/parse/label`],
  ],
  "nutritionTargets.routes": [
    ["get", `${BASE}/targets`],
    ["post", `${BASE}/targets`],
    ["post", `${BASE}/meal-targets`],
    ["delete", `${BASE}/meal-targets/:mealType`],
    ["get", `${BASE}/micros`],
  ],
  "nutritionInsights.routes": [
    ["get", `${BASE}/insights`],
    ["post", `${BASE}/insights`],
  ],
  "nutritionRecipes.routes": [
    ["post", `${BASE}/recipes`],
    ["get", `${BASE}/recipes`],
    ["get", `${BASE}/recipes/:id`],
    ["patch", `${BASE}/recipes/:id`],
    ["delete", `${BASE}/recipes/:id`],
  ],
};

const EXPECTED_ENDPOINT_COUNT = 38;

/**
 * "method path" for every registered route, in registration order. A route
 * holds one handler layer per middleware in its chain (auth, limiter,
 * validator, handler), each stamped with the method, so collapse them.
 */
function routeTable(router: Router): string[] {
  return router.stack.flatMap((layer) => {
    const route = layer.route;
    if (!route) return [];
    const methods = new Set(route.stack.map((handler) => handler.method));
    return [...methods].map((method) => `${method} ${route.path}`);
  });
}

describe("nutrition route entrypoint", () => {
  it("exports the canonical nutrition router from routes/nutrition/index", () => {
    expect(nutritionRouter).toBeDefined();
  });

  it("registers every sub-module's endpoints through registerNutritionRoutes", () => {
    const router = Router();
    registerNutritionRoutes(router);
    const registered = routeTable(router);
    const unique = new Set(registered);

    for (const [module, routes] of Object.entries(EXPECTED_ROUTES)) {
      for (const [method, path] of routes) {
        expect(unique, `${module} should register ${method} ${path}`).toContain(`${method} ${path}`);
      }
    }
    const expectedTotal = Object.values(EXPECTED_ROUTES).reduce((n, routes) => n + routes.length, 0);
    expect(expectedTotal).toBe(EXPECTED_ENDPOINT_COUNT);
    // No endpoint registered twice (a handler moved but not removed) and none
    // registered that the table does not know about.
    expect(registered).toHaveLength(EXPECTED_ENDPOINT_COUNT);
    expect(unique.size).toBe(EXPECTED_ENDPOINT_COUNT);
  });

  it("keeps the static /foods GETs ahead of GET /foods/:id so the param route cannot swallow them", () => {
    const router = Router();
    registerNutritionRoutes(router);
    const registered = routeTable(router);
    const paramIndex = registered.indexOf(`get ${BASE}/foods/:id`);
    expect(paramIndex).toBeGreaterThan(-1);
    for (const staticPath of ["search", "recent", "custom"]) {
      const staticIndex = registered.indexOf(`get ${BASE}/foods/${staticPath}`);
      expect(staticIndex).toBeGreaterThan(-1);
      expect(staticIndex).toBeLessThan(paramIndex);
    }
  });
});
