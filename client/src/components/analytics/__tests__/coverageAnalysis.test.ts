import { describe, expect, it } from "vitest";

import {
  buildBalanceAnalysis,
  type CoverageWork,
  describeNextFocus,
  findLeastLoadedCoverage,
} from "../coverageAnalysis";

function work(label: string, totalSets: number, daysSince: number | null = 3): CoverageWork {
  return {
    label,
    sessionCount: totalSets > 0 ? 1 : 0,
    totalSets,
    lastTrained: daysSince === null ? null : "2026-11-19",
    daysSince,
  };
}

// CC-coverage (REFACTORING_REVIEW 2026-09-23): the scan and the "Next focus"
// line the movement-pattern and muscle analyses share.
describe("findLeastLoadedCoverage", () => {
  it("picks the trained item with the fewest sets, breaking ties by label", () => {
    const items = [work("Squat", 12), work("Lunge", 4), work("Hinge", 4), work("Carry", 0, null)];

    expect(findLeastLoadedCoverage(items)?.label).toBe("Hinge");
  });

  it("is null when nothing is trained", () => {
    expect(findLeastLoadedCoverage([work("Squat", 0, null)])).toBeNull();
  });
});

describe("describeNextFocus", () => {
  const base = { itemNoun: "pattern", emptyFocus: "Next focus: Log something." } as const;
  const balanced = buildBalanceAnalysis("Push / Pull", "Push", 10, "pull", 10);
  const unbalanced = buildBalanceAnalysis("Push / Pull", "Push", 20, "pull", 5);

  it("leads with the priority gap", () => {
    expect(
      describeNextFocus({
        ...base,
        priorityGap: { item: work("Hinge", 0, null), reason: "it has no logged sessions in this range" },
        nextBalance: unbalanced,
        leastLoaded: work("Lunge", 4),
      }),
    ).toBe("Next focus: Add Hinge; it has no logged sessions in this range.");
  });

  it("then the first unbalanced pair's recommendation", () => {
    expect(
      describeNextFocus({ ...base, priorityGap: null, nextBalance: unbalanced, leastLoaded: work("Lunge", 4) }),
    ).toBe(`Next focus: ${unbalanced.recommendation}`);
  });

  it("then the least-loaded trained item, named with the item noun", () => {
    expect(
      describeNextFocus({ ...base, priorityGap: null, nextBalance: undefined, leastLoaded: work("Lunge", 4) }),
    ).toBe("Next focus: Keep Lunge in rotation; it is the lowest loaded trained pattern.");
    expect(balanced.recommendation).toBeNull();
  });

  it("falls back to the empty copy", () => {
    expect(describeNextFocus({ ...base, priorityGap: null, nextBalance: undefined, leastLoaded: null })).toBe(
      "Next focus: Log something.",
    );
  });
});
