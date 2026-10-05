import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { storage } from "../../storage";
import { makeLogRow } from "./foodTestFixture";
import { buildNutritionSummary } from "./nutritionSummary";

vi.mock("../../storage", () => ({
  storage: {
    users: { getUser: vi.fn() },
    nutrition: {
      listEntriesWithFoodForDateRange: vi.fn(),
      getCurrentTarget: vi.fn(),
    },
    analytics: {
      getWorkoutLogsByDateRange: vi.fn(),
      getAllExerciseSetsWithDates: vi.fn(),
      getExerciseLoadTags: vi.fn(),
    },
  },
}));

const TODAY = "2026-06-08";
const YESTERDAY = "2026-06-07";
/** The athlete has set no nutrition target. */
const NO_TARGET = undefined;

/** 100 g of a food carrying `iron` mg per 100 g, logged on `logDate`. */
function ironRow(logDate: string, iron: number, id: string) {
  return makeLogRow({ id, logDate }, { id: `f-${id}`, micros: { iron } });
}

// C8 (CODEBASE_ANALYSIS_2026-10-03): micros were judged on the athlete's local
// today only — empty at the midnight recompute, part-eaten mid-morning.
describe("buildNutritionSummary micronutrients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${TODAY}T09:30:00Z`));
    vi.mocked(storage.users).getUser.mockResolvedValue({ userTimezone: "UTC" } as never);
    vi.mocked(storage.nutrition).getCurrentTarget.mockResolvedValue(NO_TARGET);
    vi.mocked(storage.analytics).getWorkoutLogsByDateRange.mockResolvedValue([]);
    vi.mocked(storage.analytics).getAllExerciseSetsWithDates.mockResolvedValue([]);
    vi.mocked(storage.analytics).getExerciseLoadTags.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("judges yesterday's finished day at the midnight recompute, not the empty today", async () => {
    vi.setSystemTime(new Date(`${TODAY}T00:05:00Z`));
    vi.mocked(storage.nutrition).listEntriesWithFoodForDateRange.mockResolvedValue([
      ironRow(YESTERDAY, 18, "e1"),
    ]);

    const summary = await buildNutritionSummary("u1");

    expect(summary.microDate).toBe(YESTERDAY);
    expect(summary.microStatus).toBe("all_ok");
  });

  it("ignores a part-eaten today that would read as low", async () => {
    vi.mocked(storage.nutrition).listEntriesWithFoodForDateRange.mockResolvedValue([
      ironRow(YESTERDAY, 18, "e1"),
      // Breakfast only: 2 mg of an 18 mg reference intake.
      ironRow(TODAY, 2, "e2"),
    ]);

    const summary = await buildNutritionSummary("u1");

    expect(summary.microDate).toBe(YESTERDAY);
    expect(summary.microStatus).toBe("all_ok");
    expect(summary.lowMicros).toEqual([]);
  });

  it("flags a low micro on the latest complete day, skipping older days", async () => {
    vi.mocked(storage.nutrition).listEntriesWithFoodForDateRange.mockResolvedValue([
      ironRow("2026-06-05", 18, "e1"),
      ironRow("2026-06-06", 4, "e2"),
      ironRow(TODAY, 18, "e3"),
    ]);

    const summary = await buildNutritionSummary("u1");

    expect(summary.microDate).toBe("2026-06-06");
    expect(summary.microStatus).toBe("low");
    expect(summary.lowMicros).toEqual([{ label: "Iron", pctRdi: 22 }]);
  });

  it("reports no data when only today has food logged", async () => {
    vi.mocked(storage.nutrition).listEntriesWithFoodForDateRange.mockResolvedValue([
      ironRow(TODAY, 2, "e1"),
    ]);

    const summary = await buildNutritionSummary("u1");

    expect(summary.microDate).toBeNull();
    expect(summary.microStatus).toBe("no_data");
  });
});
