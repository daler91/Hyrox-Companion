import { beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "../../logger";
import type { UpcomingPlannedDay } from "../../storage/timeline";
import { buildNutritionSummary, type NutritionSummary } from "../nutrition/nutritionSummary";
import { buildNextSessionFuelling, buildNutritionTrainingContext } from "./nutritionContext";

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: { NUTRITION_ENABLED: "true" },
}));
vi.mock("../../env", () => ({ env: mockEnv }));
vi.mock("../../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../nutrition/nutritionSummary", () => ({ buildNutritionSummary: vi.fn() }));

function summary(overrides: Partial<NutritionSummary> = {}): NutritionSummary {
  return {
    windowDays: 14,
    from: "2026-05-26",
    to: "2026-06-08",
    loggedDaysCount: 5,
    avgLoggedDay: { calories: 2400, protein: 160, carb: 270, fat: 78 },
    target: { calories: 2600, proteinG: 180, carbG: 300, fatG: 75 },
    highLoadDays: [
      { date: "2026-06-05", utss: 90, calories: 2200, protein: 140 },
      { date: "2026-06-04", utss: 80, calories: 2500, protein: 170 },
      { date: "2026-06-03", utss: 70, calories: 2300, protein: 150 },
      { date: "2026-06-02", utss: 60, calories: 2100, protein: 130 },
    ],
    hasTrainingLoad: true,
    microStatus: "low",
    lowMicros: [{ label: "Iron", pctRdi: 32 }],
    ...overrides,
  };
}

describe("buildNutritionTrainingContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.NUTRITION_ENABLED = "true";
    vi.mocked(buildNutritionSummary).mockResolvedValue(summary());
  });

  it("returns undefined when the nutrition feature is disabled", async () => {
    mockEnv.NUTRITION_ENABLED = "false";
    expect(await buildNutritionTrainingContext("u1")).toBeUndefined();
    expect(buildNutritionSummary).not.toHaveBeenCalled();
  });

  it("returns undefined when there are no logs and no target", async () => {
    vi.mocked(buildNutritionSummary).mockResolvedValue(summary({ loggedDaysCount: 0, target: null }));
    expect(await buildNutritionTrainingContext("u1")).toBeUndefined();
  });

  it("includes the context when a target exists even with no logs", async () => {
    vi.mocked(buildNutritionSummary).mockResolvedValue(summary({ loggedDaysCount: 0 }));
    const ctx = await buildNutritionTrainingContext("u1");
    expect(ctx).toBeDefined();
    expect(ctx?.loggedDaysCount).toBe(0);
    expect(ctx?.target).toEqual({ calories: 2600, proteinG: 180, carbG: 300, fatG: 75 });
  });

  it("maps the summary, formats low micros, and caps high-load days at 3", async () => {
    const ctx = await buildNutritionTrainingContext("u1");
    expect(ctx).toMatchObject({
      windowDays: 14,
      loggedDaysCount: 5,
      avgCalories: 2400,
      avgProteinG: 160,
      avgCarbG: 270,
      avgFatG: 78,
      lowMicros: ["Iron 32%"],
    });
    expect(ctx?.highLoadDays).toHaveLength(3);
    expect(ctx?.highLoadDays[0]).toEqual({
      date: "2026-06-05",
      utss: 90,
      calories: 2200,
      proteinG: 140,
    });
  });

  it("degrades gracefully (undefined + warning) when the summary build throws", async () => {
    vi.mocked(buildNutritionSummary).mockRejectedValue(new Error("db down"));
    expect(await buildNutritionTrainingContext("u1")).toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});

function makeDay(overrides: Partial<UpcomingPlannedDay> = {}): UpcomingPlannedDay {
  return {
    planDayId: "pd-1",
    date: "2026-06-10",
    focus: "Strength",
    mainWorkout: "5x5 squat",
    accessory: null,
    notes: null,
    aiSource: null,
    aiRationale: null,
    aiNoteUpdatedAt: null,
    aiInputsUsed: null,
    expectedDurationMin: null,
    expectedRpe: null,
    exerciseSets: [],
    structureBlocks: [],
    ...overrides,
  };
}

describe("buildNextSessionFuelling", () => {
  it("prefers the athlete's saved expected duration and RPE", () => {
    const out = buildNextSessionFuelling(makeDay({ expectedDurationMin: 90, expectedRpe: 9 }), 75);

    expect(out).toMatchObject({
      date: "2026-06-10",
      focus: "Strength",
      durationMin: 90,
      rpe: 9,
      estimated: false,
    });
    expect(out.preCarbG).toBe(61); // 75kg × 0.4 g/kg × 1.35 (hard) × 1.5h
  });

  it("estimates duration and RPE from the planned exercise table", () => {
    const out = buildNextSessionFuelling(
      makeDay({
        structureBlocks: [
          { sectionType: "main", formatType: "for_time", timeCapMinutes: 45, steps: [] },
        ],
      }),
      75,
    );

    expect(out).toMatchObject({ durationMin: 45, rpe: 8, estimated: true });
    expect(out.preCarbG).toBe(30); // 75kg × 0.4 g/kg × 1.35 (hard) × 0.75h
  });

  it("falls back to calculator defaults when nothing is known", () => {
    const out = buildNextSessionFuelling(makeDay(), null);

    expect(out).toMatchObject({
      durationMin: null,
      rpe: null,
      estimated: true,
      preCarbG: 30,
      postCarbG: 60,
      postProteinG: 25,
    });
  });
});
