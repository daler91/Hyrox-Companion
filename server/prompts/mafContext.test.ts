import { describe, expect, it } from "vitest";

import type { MafTrendSummary, TrainingContext } from "../gemini/types";
import { formatMafContext } from "./mafContext";

function context(overrides: Partial<TrainingContext> = {}): TrainingContext {
  return {
    totalWorkouts: 10,
    completedWorkouts: 7,
    plannedWorkouts: 2,
    missedWorkouts: 1,
    skippedWorkouts: 0,
    completionRate: 70,
    currentStreak: 3,
    recentWorkouts: [],
    exerciseBreakdown: {},
    ...overrides,
  };
}

function trend(overrides: Partial<MafTrendSummary> = {}): MafTrendSummary {
  return {
    testCount: 4,
    lastTestDaysAgo: 12,
    latestClassification: "mostly_compliant",
    latestCompliancePct: 87,
    complianceTrend: "improving",
    ...overrides,
  };
}

describe("formatMafContext", () => {
  it("renders nothing for an athlete not on the MAF method", () => {
    // mafHr can linger on the profile after switching styles; mafTrend is only
    // set for athletes whose CURRENT style is maf_method, so it is the gate.
    expect(formatMafContext(context())).toBe("");
    expect(formatMafContext(context({ mafHr: 137 }))).toBe("");
  });

  it("states the ceiling as a hard bound with the test summary", () => {
    const out = formatMafContext(context({ mafHr: 137, mafTrend: trend() }));

    expect(out).toContain("--- MAF METHOD ---");
    expect(out).toContain("Aerobic ceiling: 137 bpm");
    expect(out).toContain("do not prescribe heart-rate targets above it");
    expect(out).toContain("MAF tests: 4 logged, last 12 days ago");
    expect(out).toContain("mostly compliant (87% under ceiling)");
    expect(out).toContain("compliance trend improving");
  });

  it("suggests a baseline test when none are logged", () => {
    const out = formatMafContext(
      context({
        mafHr: 137,
        mafTrend: trend({
          testCount: 0,
          lastTestDaysAgo: null,
          latestClassification: null,
          latestCompliancePct: null,
          complianceTrend: "insufficient_data",
        }),
      }),
    );

    expect(out).toContain("No MAF tests logged yet — suggest a baseline test");
  });

  it("nudges a retest when the last one has gone stale", () => {
    const out = formatMafContext(context({ mafHr: 137, mafTrend: trend({ lastTestDaysAgo: 45 }) }));

    expect(out).toContain("over 28 days old");
  });

  it("does not nudge inside the cadence window", () => {
    const out = formatMafContext(context({ mafHr: 137, mafTrend: trend({ lastTestDaysAgo: 12 }) }));

    expect(out).not.toContain("days old");
  });

  it("still summarises tests when no ceiling is stored", () => {
    const out = formatMafContext(context({ mafHr: null, mafTrend: trend() }));

    expect(out).not.toContain("Aerobic ceiling");
    expect(out).toContain("MAF tests: 4 logged");
  });
});
