import { addDaysToISODate } from "@shared/dateUtils";
import type { EffectiveTargetSummary, FuellingDayPoint, NutritionTarget } from "@shared/schema";
import { Router } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearRateLimitBuckets } from "../../../routeUtils";
import { makeWorkoutLog } from "../../../services/trainingLoadService.testHelpers";
import { storage } from "../../../storage";
import { createTestApp } from "../../__tests__/testUtils";
import { registerNutritionSummaryRoutes } from "../nutritionSummary.routes";

vi.mock("../../../clerkAuth", async () =>
  (await import("../../__tests__/testUtils")).mockClerkAuthModule(),
);
vi.mock("../../../types", async () =>
  (await import("../../__tests__/testUtils")).mockTypesModule(),
);
vi.mock("../../../storage", async () =>
  (await import("../../__tests__/testUtils")).mockStorageModule({
    users: ["getUser"],
    analytics: [
      "getWorkoutLogsByDateRange",
      "getAllExerciseSetsWithDates",
      "getExerciseLoadTags",
      "getPlannedDaysForDate",
    ],
    nutrition: [
      "getCurrentTarget",
      "listTargets",
      "listEntriesWithFoodForDate",
      "listEntriesWithFoodForDateRange",
      "getMealTargetOverrides",
    ],
    timeline: ["getUpcomingPlannedDays"],
    plans: ["getActivePlan"],
  }),
);

// C31 (CODEBASE_ANALYSIS_2026-10-03): /summary (the Nutrition page) built an
// adaptive target's full window — recent load, the upcoming plan, the plan
// phase — while /summary-range (the Timeline chip) scaled every day by its own
// load alone, so the two showed different carb targets for the same day. The
// real load engine runs here, so the recovery TSB, which depends on where a
// day's load history starts, is exercised too.
describe("a day's effective target is the same on /summary and /summary-range (C31)", () => {
  const DAY = "2026-06-10";

  const ADAPTIVE_TARGET = {
    id: "t1",
    userId: "test_user",
    effectiveFrom: "2026-01-01",
    calories: 2600,
    proteinG: 150,
    carbG: 320,
    fatG: 80,
    periodizationEnabled: true,
    referenceUtss: 40,
    carbGramsPerUtss: 2,
    recoveryEnabled: true,
    recoveryProteinBumpFrac: 0.15,
    preloadCarbGramsPerUtss: 1,
    preloadDaysAhead: 2,
    phaseAware: true,
    maxCarbDeltaG: 240,
  } as unknown as NutritionTarget;

  // Four months of training: base work, a heavy block 8-14 weeks back, base
  // work again, then a harder final week ending in a rest day on DAY, so
  // recovery, TSB and the fatigue protein bump all move. A day's history used
  // to start wherever its request did: a narrow request for DAY-1 missed most
  // of the heavy block and a wide one took it in, and that moved DAY-1's TSB
  // and so its recovery protein.
  const LOGS = Array.from({ length: 120 }, (_, i) => {
    const daysBack = 120 - i;
    let rpe = 5;
    if (daysBack > 57 && daysBack <= 100) rpe = 9;
    else if (daysBack <= 7) rpe = 6;
    return makeWorkoutLog({
      id: `log-${i}`,
      date: addDaysToISODate(DAY, -daysBack),
      duration: daysBack > 7 && i % 7 === 3 ? null : 45 + (i % 5) * 10,
      rpe,
    });
  });

  function buildApp() {
    const router = Router();
    registerNutritionSummaryRoutes(router);
    return createTestApp(router);
  }

  beforeEach(() => {
    vi.resetAllMocks();
    clearRateLimitBuckets();
    vi.mocked(storage.users.getUser).mockResolvedValue({
      userTimezone: "UTC",
      weightUnit: "kg",
      distanceUnit: "km",
      bodyweightKg: 75,
    } as never);
    vi.mocked(storage.analytics.getWorkoutLogsByDateRange).mockImplementation((_userId, from, to) =>
      Promise.resolve(LOGS.filter((log) => (!from || log.date >= from) && (!to || log.date <= to))),
    );
    vi.mocked(storage.analytics.getAllExerciseSetsWithDates).mockResolvedValue([]);
    vi.mocked(storage.analytics.getExerciseLoadTags).mockResolvedValue([]);
    vi.mocked(storage.analytics.getPlannedDaysForDate).mockResolvedValue([]);
    vi.mocked(storage.nutrition.getCurrentTarget).mockResolvedValue(ADAPTIVE_TARGET);
    vi.mocked(storage.nutrition.listTargets).mockResolvedValue([ADAPTIVE_TARGET] as never);
    vi.mocked(storage.nutrition.listEntriesWithFoodForDate).mockResolvedValue([]);
    vi.mocked(storage.nutrition.listEntriesWithFoodForDateRange).mockResolvedValue([]);
    vi.mocked(storage.nutrition.getMealTargetOverrides).mockResolvedValue(new Map() as never);
    // A big session the day after DAY, to pre-load for.
    vi.mocked(storage.timeline.getUpcomingPlannedDays).mockResolvedValue([
      {
        date: addDaysToISODate(DAY, 1),
        expectedDurationMin: 120,
        expectedRpe: 8,
        structureBlocks: [],
        exerciseSets: [],
      },
    ] as never);
    vi.mocked(storage.plans.getActivePlan).mockResolvedValue({
      startDate: "2026-04-06",
      endDate: "2026-07-26",
      raceDate: "2026-07-26",
      totalWeeks: 16,
    } as never);
  });

  async function summaryTarget(
    app: ReturnType<typeof buildApp>,
    date: string,
  ): Promise<EffectiveTargetSummary> {
    const res = await request(app).get(`/api/v1/nutrition/summary?date=${date}`);
    expect(res.status).toBe(200);
    return res.body.effectiveTarget;
  }

  async function rangeTargets(
    app: ReturnType<typeof buildApp>,
    from: string,
    to: string,
  ): Promise<Map<string, EffectiveTargetSummary | null>> {
    const res = await request(app).get(`/api/v1/nutrition/summary-range?from=${from}&to=${to}`);
    expect(res.status).toBe(200);
    return new Map(res.body.days.map((day: FuellingDayPoint) => [day.date, day.effectiveTarget]));
  }

  it("resolves each day of the range exactly as the daily summary does", async () => {
    const app = buildApp();
    const range = await rangeTargets(app, addDaysToISODate(DAY, -3), addDaysToISODate(DAY, 1));

    for (const date of [
      addDaysToISODate(DAY, -3),
      addDaysToISODate(DAY, -1),
      DAY,
      addDaysToISODate(DAY, 1),
    ]) {
      expect(range.get(date)).toEqual(await summaryTarget(app, date));
    }

    // The adaptive parts really moved the day, so the comparison above is not
    // of two plain load-scaled targets.
    const day = await summaryTarget(app, DAY);
    expect(day.recoveryDeltaG).toBeGreaterThan(0);
    expect(day.preloadDeltaG).toBeGreaterThan(0);
    expect(day.proteinDeltaG).toBeGreaterThan(0);
    expect(day.phase).not.toBeNull();
  });

  it("gives a day the same target whichever range it is read in", async () => {
    const app = buildApp();
    const narrow = await rangeTargets(app, addDaysToISODate(DAY, -1), DAY);
    const wide = await rangeTargets(app, addDaysToISODate(DAY, -60), addDaysToISODate(DAY, 5));

    expect(wide.get(DAY)).toEqual(narrow.get(DAY));
    expect(wide.get(addDaysToISODate(DAY, -1))).toEqual(narrow.get(addDaysToISODate(DAY, -1)));
  });
});
