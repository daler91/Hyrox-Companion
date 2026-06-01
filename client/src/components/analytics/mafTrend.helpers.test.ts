import { describe, expect, it } from "vitest";

import type { MafTestResult, MafTestsListResponse, MafWorkoutAnalysis } from "@/lib/api";

import {
  buildComplianceTrendData,
  buildTestRows,
  classificationMeta,
  isWorkoutTagged,
} from "./mafTrend.helpers";

function analysis(partial: Partial<MafWorkoutAnalysis>): MafWorkoutAnalysis {
  return partial as MafWorkoutAnalysis;
}

function test(partial: Partial<MafTestResult>): MafTestResult {
  return partial as MafTestResult;
}

describe("buildComplianceTrendData", () => {
  it("orders points oldest → newest and drops unscored / undated rows", () => {
    const points = buildComplianceTrendData([
      analysis({ workoutLogId: "w2", compliancePct: 90, createdAt: "2026-05-01T12:00:00Z" as unknown as Date }),
      analysis({ workoutLogId: "w1", compliancePct: 70, createdAt: "2026-03-01T12:00:00Z" as unknown as Date }),
      analysis({ workoutLogId: "w3", compliancePct: null, createdAt: "2026-06-01T12:00:00Z" as unknown as Date }),
      analysis({ workoutLogId: "w4", compliancePct: 80, createdAt: null }),
    ]);

    expect(points).toEqual([
      { date: "2026-03-01", compliancePct: 70 },
      { date: "2026-05-01", compliancePct: 90 },
    ]);
  });
});

describe("isWorkoutTagged", () => {
  const data: MafTestsListResponse = {
    tests: [test({ id: "t1", conditions: { source: "tagged_workout", workoutLogId: "w-no-hr" } })],
    analysis: [analysis({ workoutLogId: "w-scored", compliancePct: 88 })],
  };

  it("is true when a scored analysis row references the workout", () => {
    expect(isWorkoutTagged(data, "w-scored")).toBe(true);
  });

  it("is true when only the test row (no HR / no analysis) references the workout", () => {
    expect(isWorkoutTagged(data, "w-no-hr")).toBe(true);
  });

  it("is false for an untagged workout or missing data", () => {
    expect(isWorkoutTagged(data, "w-other")).toBe(false);
    expect(isWorkoutTagged(undefined, "w-scored")).toBe(false);
  });
});

describe("buildTestRows", () => {
  it("pairs tests with their analysis by workoutLogId, newest first", () => {
    const data: MafTestsListResponse = {
      tests: [
        test({ id: "t-old", protocolType: "fixed_time_run", conditions: { workoutLogId: "w1" }, createdAt: "2026-03-01T00:00:00Z" as unknown as Date }),
        test({ id: "t-new", protocolType: "maf_test", conditions: { workoutLogId: "w2" }, createdAt: "2026-05-01T00:00:00Z" as unknown as Date }),
      ],
      analysis: [analysis({ workoutLogId: "w1", compliancePct: 75, classification: "over_ceiling" })],
    };

    const rows = buildTestRows(data);
    expect(rows.map((r) => r.id)).toEqual(["t-new", "t-old"]);
    // t-new has no analysis row → unscored
    expect(rows[0]).toMatchObject({ id: "t-new", compliancePct: null, classification: null, date: "2026-05-01" });
    expect(rows[1]).toMatchObject({ id: "t-old", compliancePct: 75, classification: "over_ceiling" });
  });

  it("returns an empty list when there is no data", () => {
    expect(buildTestRows(undefined)).toEqual([]);
  });
});

describe("classificationMeta", () => {
  it("maps known classifications to labels + tones", () => {
    expect(classificationMeta("compliant")).toEqual({ label: "Compliant", tone: "green" });
    expect(classificationMeta("over_ceiling")).toEqual({ label: "Over ceiling", tone: "red" });
  });

  it("falls back gracefully for null / unknown", () => {
    expect(classificationMeta(null).label).toBe("Unscored");
    expect(classificationMeta("weird").label).toBe("weird");
  });
});
