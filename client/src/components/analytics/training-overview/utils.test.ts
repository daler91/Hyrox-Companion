import type { TrainingOverview, WeeklySummary } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { annotationToWeekBounds, buildTrendData } from "./utils";

describe("annotationToWeekBounds", () => {
  it("returns null when an annotation does not overlap visible weeks", () => {
    expect(
      annotationToWeekBounds({ startDate: "2026-04-01", endDate: "2026-04-02" }, [
        "2026-04-06",
        "2026-04-13",
      ]),
    ).toBeNull();
  });

  it("returns the first and last overlapping week starts", () => {
    expect(
      annotationToWeekBounds({ startDate: "2026-04-08", endDate: "2026-04-20" }, [
        "2026-04-06",
        "2026-04-13",
        "2026-04-20",
        "2026-04-27",
      ]),
    ).toEqual({ x1: "2026-04-06", x2: "2026-04-20" });
  });
});

function week(over: Partial<WeeklySummary> = {}): WeeklySummary {
  return {
    weekStart: "2026-05-04",
    workoutCount: 0,
    totalDuration: 0,
    avgRpe: null,
    categoryBreakdown: {},
    workoutsWithDuration: 0,
    rpeCount: 0,
    runningMeters: 0,
    ...over,
  };
}

function overview(weeklySummaries: WeeklySummary[]): TrainingOverview {
  return { weeklySummaries } as unknown as TrainingOverview;
}

describe("buildTrendData", () => {
  it("returns empty series when there is no overview", () => {
    expect(buildTrendData(undefined)).toEqual({
      rpeData: [],
      durationData: [],
      mileageData: [],
    });
  });

  it("skips a week with no recorded RPE or duration but still totals its mileage", () => {
    const result = buildTrendData(
      overview([week({ weekStart: "2026-05-04", avgRpe: null, totalDuration: 0, runningMeters: 5000 })]),
    );

    expect(result.rpeData).toEqual([]);
    expect(result.durationData).toEqual([]);
    expect(result.mileageData).toEqual([{ weekStart: "2026-05-04", runningMeters: 5000 }]);
  });

  it("averages duration per workout that recorded one, rounded", () => {
    const result = buildTrendData(
      overview([
        week({ weekStart: "2026-05-04", totalDuration: 100, workoutCount: 3, workoutsWithDuration: 3 }),
      ]),
    );

    expect(result.durationData).toEqual([{ weekStart: "2026-05-04", avgDuration: 33 }]);
  });

  it("pools duration over the workouts that recorded one, not every workout (audit H8, CL5)", () => {
    // 10 workouts, only 5 of them recorded 60 min: the average is 60, matching
    // the stat card, not 300 / 10 = 30.
    const result = buildTrendData(
      overview([
        week({ weekStart: "2026-05-04", totalDuration: 300, workoutCount: 10, workoutsWithDuration: 5 }),
      ]),
    );

    expect(result.durationData).toEqual([{ weekStart: "2026-05-04", avgDuration: 60 }]);
  });

  it("skips a week where no workout recorded a duration", () => {
    const result = buildTrendData(
      overview([
        week({ weekStart: "2026-05-04", totalDuration: 0, workoutCount: 4, workoutsWithDuration: 0 }),
        week({ weekStart: "2026-05-11", totalDuration: 45, workoutCount: 2, workoutsWithDuration: 1 }),
      ]),
    );

    expect(result.durationData).toEqual([{ weekStart: "2026-05-11", avgDuration: 45 }]);
  });

  it("drops the mileage series entirely when every week has zero running", () => {
    const result = buildTrendData(
      overview([
        week({ weekStart: "2026-05-04", runningMeters: 0 }),
        week({ weekStart: "2026-05-11", runningMeters: 0 }),
      ]),
    );

    expect(result.mileageData).toEqual([]);
  });

  it("keeps zero-mileage weeks in the series once at least one week has running", () => {
    const result = buildTrendData(
      overview([
        week({ weekStart: "2026-05-04", runningMeters: 0 }),
        week({ weekStart: "2026-05-11", runningMeters: 8000 }),
      ]),
    );

    expect(result.mileageData).toEqual([
      { weekStart: "2026-05-04", runningMeters: 0 },
      { weekStart: "2026-05-11", runningMeters: 8000 },
    ]);
  });
});
