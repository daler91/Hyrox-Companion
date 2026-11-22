import { Router } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearRateLimitBuckets } from "../../../routeUtils";
import { storage } from "../../../storage";
import { createTestApp } from "../../__tests__/testUtils";
import { registerNutritionRoutes } from "../nutrition.routes";

vi.mock("../../../clerkAuth", async () =>
  (await import("../../__tests__/testUtils")).mockClerkAuthModule(),
);
vi.mock("../../../types", async () =>
  (await import("../../__tests__/testUtils")).mockTypesModule(),
);
vi.mock("../../../storage", async () =>
  (await import("../../__tests__/testUtils")).mockStorageModule({
    users: ["getUser"],
    analytics: ["getWorkoutLogsByDateRange", "getPlannedDaysForDate"],
    nutrition: [
      "listEntriesWithFoodForDate",
      "listEntriesWithFoodForDateRange",
      "getCurrentTarget",
      "listTargets",
      "createTarget",
      "upsertMealTarget",
      "repeatDay",
    ],
  }),
);

// C49 (CODEBASE_ANALYSIS_2026-10-03): the nutrition date check used Date.parse,
// which rolls an impossible day such as 2026-02-30 into March, so these routes
// passed it on and the database answered 500. The shared calendar round trip
// (isIsoCalendarDate) now turns it away as a 400 before anything is read.
describe("impossible calendar dates are a 400 on every nutrition date input (C49)", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.resetAllMocks();
    clearRateLimitBuckets();
    const router = Router();
    registerNutritionRoutes(router);
    app = createTestApp(router);
    vi.mocked(storage.users.getUser).mockResolvedValue({ userTimezone: "UTC" } as never);
  });

  it.each([
    ["the daily summary", "/api/v1/nutrition/summary?date=2026-02-30"],
    ["the micronutrient summary", "/api/v1/nutrition/micros?date=2025-02-29"],
    ["the block view", "/api/v1/nutrition/block?from=2026-04-31&to=2026-05-03"],
    ["the fuelling range", "/api/v1/nutrition/summary-range?from=2026-02-27&to=2026-02-30"],
  ])("rejects %s", async (_label, url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(storage.nutrition.listEntriesWithFoodForDate).not.toHaveBeenCalled();
    expect(storage.nutrition.listEntriesWithFoodForDateRange).not.toHaveBeenCalled();
  });

  it("rejects an impossible effectiveFrom on a target or a meal target", async () => {
    const target = await request(app)
      .post("/api/v1/nutrition/targets")
      .send({ calories: 2000, effectiveFrom: "2026-02-30" });
    const mealTarget = await request(app)
      .post("/api/v1/nutrition/meal-targets")
      .send({ mealType: "dinner", carbG: 100, effectiveFrom: "2026-06-31" });

    expect(target.status).toBe(400);
    expect(mealTarget.status).toBe(400);
    expect(storage.nutrition.createTarget).not.toHaveBeenCalled();
    expect(storage.nutrition.upsertMealTarget).not.toHaveBeenCalled();
  });

  it("rejects an impossible day to repeat", async () => {
    const res = await request(app)
      .post("/api/v1/nutrition/logs/repeat")
      .send({ sourceDate: "2026-02-30" });
    expect(res.status).toBe(400);
    expect(storage.nutrition.repeatDay).not.toHaveBeenCalled();
  });

  it("still serves a real leap day", async () => {
    vi.mocked(storage.nutrition.listEntriesWithFoodForDate).mockResolvedValue([]);
    const res = await request(app).get("/api/v1/nutrition/summary?date=2028-02-29");
    expect(res.status).toBe(200);
    expect(res.body.logDate).toBe("2028-02-29");
  });
});

// Tech debt #44: repeating a day onto another date stamped 12:00 UTC, which is
// another local day for an athlete far from UTC.
describe("POST /api/v1/nutrition/logs/repeat stamps the athlete's local noon", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.resetAllMocks();
    clearRateLimitBuckets();
    const router = Router();
    registerNutritionRoutes(router);
    app = createTestApp(router);
    vi.mocked(storage.nutrition.repeatDay).mockResolvedValue(2);
  });

  it("stamps noon on the target date in the athlete's own zone", async () => {
    vi.mocked(storage.users.getUser).mockResolvedValue({ userTimezone: "Pacific/Kiritimati" } as never);

    const res = await request(app)
      .post("/api/v1/nutrition/logs/repeat")
      .send({ sourceDate: "2020-01-01", targetDate: "2020-01-02" });

    expect(res.status).toBe(201);
    const { loggedAt, targetDate } = vi.mocked(storage.nutrition.repeatDay).mock.calls[0][1];
    expect(targetDate).toBe("2020-01-02");
    expect(loggedAt.toISOString()).toBe("2020-01-01T22:00:00.000Z");
  });
});

// D8 (REFACTORING_REVIEW 2026-09-23): a stored timezone the runtime rejects (a
// legacy row, or a name dropped from tzdata) made these routes throw a
// RangeError and answer 500. It now reads as UTC.
describe("an unrecognisable stored timezone reads as UTC", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.resetAllMocks();
    clearRateLimitBuckets();
    const router = Router();
    registerNutritionRoutes(router);
    app = createTestApp(router);
    vi.mocked(storage.users.getUser).mockResolvedValue({ userTimezone: "Mars/Olympus_Mons" } as never);
    vi.mocked(storage.nutrition.listEntriesWithFoodForDate).mockResolvedValue([]);
    vi.mocked(storage.nutrition.listEntriesWithFoodForDateRange).mockResolvedValue([]);
    vi.mocked(storage.nutrition.repeatDay).mockResolvedValue(1);
  });

  it("serves today's summary on the UTC date", async () => {
    const res = await request(app).get("/api/v1/nutrition/summary");
    expect(res.status).toBe(200);
    expect(res.body.logDate).toBe(new Date().toISOString().slice(0, 10));
  });

  it("stamps a repeated day at noon UTC", async () => {
    const res = await request(app)
      .post("/api/v1/nutrition/logs/repeat")
      .send({ sourceDate: "2020-01-01", targetDate: "2020-01-02" });

    expect(res.status).toBe(201);
    const { loggedAt } = vi.mocked(storage.nutrition.repeatDay).mock.calls[0][1];
    expect(loggedAt.toISOString()).toBe("2020-01-02T12:00:00.000Z");
  });
});
