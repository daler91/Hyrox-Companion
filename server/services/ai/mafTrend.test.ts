import { describe, expect, it } from "vitest";

import type { MafTestResult, MafWorkoutAnalysis } from "../../storage/mafTests";
import { summarizeMafTrend } from "./mafTrend";

const NOW = new Date("2026-06-01T00:00:00Z");

function test(createdAt: string): MafTestResult {
  return { createdAt: new Date(createdAt) } as MafTestResult;
}

function analysis(createdAt: string, compliancePct: number, classification: string): MafWorkoutAnalysis {
  return { createdAt: new Date(createdAt), compliancePct, classification } as MafWorkoutAnalysis;
}

describe("summarizeMafTrend", () => {
  it("reports an empty trend when nothing is logged", () => {
    expect(summarizeMafTrend([], [], NOW)).toEqual({
      testCount: 0,
      lastTestDaysAgo: null,
      latestClassification: null,
      latestCompliancePct: null,
      complianceTrend: "insufficient_data",
    });
  });

  it("counts tests and computes days since the most recent test", () => {
    const result = summarizeMafTrend(
      [test("2026-05-01T00:00:00Z"), test("2026-05-22T00:00:00Z"), test("2026-05-10T00:00:00Z")],
      [],
      NOW,
    );
    expect(result.testCount).toBe(3);
    expect(result.lastTestDaysAgo).toBe(10); // newest is 2026-05-22, 10 days before NOW
  });

  it("needs at least two scored analyses to call a direction", () => {
    const result = summarizeMafTrend(
      [test("2026-05-22T00:00:00Z")],
      [analysis("2026-05-22T00:00:00Z", 82, "mostly_compliant")],
      NOW,
    );
    expect(result.latestCompliancePct).toBe(82);
    expect(result.latestClassification).toBe("mostly_compliant");
    expect(result.complianceTrend).toBe("insufficient_data");
  });

  it("flags an improving trend when compliance rises over time", () => {
    const result = summarizeMafTrend(
      [],
      [
        analysis("2026-03-01T00:00:00Z", 70, "over_ceiling"),
        analysis("2026-04-01T00:00:00Z", 85, "mostly_compliant"),
        analysis("2026-05-01T00:00:00Z", 95, "compliant"),
      ],
      NOW,
    );
    expect(result.complianceTrend).toBe("improving");
    expect(result.latestClassification).toBe("compliant");
    expect(result.latestCompliancePct).toBe(95);
  });

  it("flags a declining trend when compliance falls over time", () => {
    const result = summarizeMafTrend(
      [],
      [
        analysis("2026-03-01T00:00:00Z", 95, "compliant"),
        analysis("2026-05-01T00:00:00Z", 75, "over_ceiling"),
      ],
      NOW,
    );
    expect(result.complianceTrend).toBe("declining");
  });

  it("treats small movement within the threshold as flat", () => {
    const result = summarizeMafTrend(
      [],
      [
        analysis("2026-03-01T00:00:00Z", 88, "mostly_compliant"),
        analysis("2026-05-01T00:00:00Z", 90, "mostly_compliant"),
      ],
      NOW,
    );
    expect(result.complianceTrend).toBe("flat");
  });

  it("keeps the same baseline as more tests are logged (audit M14)", () => {
    // The baseline used to be the oldest row in a 20-row fetch, so it slid
    // forward with every new test: an athlete who improved sharply and then held
    // steady watched "improving" decay to "flat" with no change in training.
    const early = analysis("2026-02-01T00:00:00Z", 60, "over_ceiling");
    const later = analysis("2026-05-01T00:00:00Z", 90, "compliant");

    const withTwo = summarizeMafTrend([], [early, later], NOW);
    // Twenty more recent, steady analyses — enough to have pushed `early` out of
    // any row-capped window.
    const filler = Array.from({ length: 20 }, (_, i) =>
      analysis(`2026-05-${String(2 + i).padStart(2, "0")}T00:00:00Z`, 90, "compliant"),
    );
    const withMany = summarizeMafTrend([], [early, later, ...filler], NOW);

    expect(withTwo.complianceTrend).toBe("improving");
    expect(withMany.complianceTrend).toBe("improving");
  });

  it("drops a baseline that has aged out of the window", () => {
    // Anchored to time: a reading from before the window is not the baseline,
    // however few rows there are.
    const result = summarizeMafTrend(
      [],
      [
        analysis("2025-06-01T00:00:00Z", 40, "over_ceiling"), // ~1 year before NOW
        analysis("2026-05-01T00:00:00Z", 90, "compliant"),
      ],
      NOW,
    );

    expect(result.complianceTrend).toBe("insufficient_data");
    expect(result.latestCompliancePct).toBe(90);
  });

  it("reports the athlete's real test count, not the fetched page size", () => {
    // `tests` is a bounded fetch, so counting it told anyone with more than
    // twenty logged tests that they had exactly twenty.
    const page = Array.from({ length: 20 }, (_, i) =>
      test(`2026-05-${String(1 + i).padStart(2, "0")}T00:00:00Z`),
    );

    expect(summarizeMafTrend(page, [], NOW).testCount).toBe(20);
    expect(summarizeMafTrend(page, [], NOW, { totalTestCount: 63 }).testCount).toBe(63);
  });

  it("orders by createdAt regardless of input order and ignores unscored analyses", () => {
    const result = summarizeMafTrend(
      [],
      [
        analysis("2026-05-01T00:00:00Z", 95, "compliant"),
        analysis("2026-03-01T00:00:00Z", 70, "over_ceiling"),
        { createdAt: new Date("2026-06-01T00:00:00Z"), compliancePct: null } as MafWorkoutAnalysis,
      ],
      NOW,
    );
    // Latest *scored* is the 2026-05-01 row (the null-pct row is dropped).
    expect(result.latestCompliancePct).toBe(95);
    expect(result.complianceTrend).toBe("improving");
  });
});
