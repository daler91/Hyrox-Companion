import { describe, expect, it, vi } from "vitest";

const { listWorkoutLogs, countWorkoutLogs, getLatestLogDate, countLogEntries } = vi.hoisted(() => ({
  listWorkoutLogs: vi.fn(),
  countWorkoutLogs: vi.fn(),
  getLatestLogDate: vi.fn(),
  countLogEntries: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: {
    workouts: { listWorkoutLogs, countWorkoutLogs },
    nutrition: { getLatestLogDate, countLogEntries },
  },
}));

import { getNutritionAnchor, getWorkoutAnchor } from "./analyticsPersistence";

describe("getWorkoutAnchor", () => {
  it("pairs the latest workout date with the total row count", async () => {
    listWorkoutLogs.mockResolvedValue([{ id: "w1", date: "2026-05-20" }]);
    countWorkoutLogs.mockResolvedValue(42);

    const anchor = await getWorkoutAnchor("u1");

    expect(anchor).toEqual({ latestDate: "2026-05-20", entryCount: 42 });
    expect(listWorkoutLogs).toHaveBeenCalledWith("u1", 1);
    expect(countWorkoutLogs).toHaveBeenCalledWith("u1");
  });

  it("reports a null latestDate when the athlete has no workouts logged", async () => {
    listWorkoutLogs.mockResolvedValue([]);
    countWorkoutLogs.mockResolvedValue(0);

    expect(await getWorkoutAnchor("u1")).toEqual({ latestDate: null, entryCount: 0 });
  });

  it("still reports the row count when a second session lands on the latest date (audit L16)", async () => {
    // Two logs sharing the latest date: the date alone can't distinguish this
    // from a single session, so the count is what makes the anchor move.
    listWorkoutLogs.mockResolvedValue([{ id: "w2", date: "2026-05-20" }]);
    countWorkoutLogs.mockResolvedValue(2);

    expect((await getWorkoutAnchor("u1")).entryCount).toBe(2);
  });
});

describe("getNutritionAnchor", () => {
  it("pairs the latest food-log date with the total entry count", async () => {
    getLatestLogDate.mockResolvedValue("2026-05-19");
    countLogEntries.mockResolvedValue(7);

    const anchor = await getNutritionAnchor("u1");

    expect(anchor).toEqual({ latestDate: "2026-05-19", entryCount: 7 });
    expect(getLatestLogDate).toHaveBeenCalledWith("u1");
    expect(countLogEntries).toHaveBeenCalledWith("u1");
  });

  it("reports a null latestDate when nothing has been logged", async () => {
    getLatestLogDate.mockResolvedValue(null);
    countLogEntries.mockResolvedValue(0);

    expect(await getNutritionAnchor("u1")).toEqual({ latestDate: null, entryCount: 0 });
  });
});
