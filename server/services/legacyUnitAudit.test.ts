import { describe, expect, it } from "vitest";

import {
  type AthleteUnitReport,
  isSafeToStamp,
  type LegacyUnitVerdict,
  verdictFor,
} from "./legacyUnitAudit";
import type { DetectedSwitch } from "./unitSwitchDetection";

const A_SWITCH: DetectedSwitch = {
  onDate: "2026-02-02",
  direction: "up",
  expectedFactor: 2.20462,
  evidence: [{ exercise: "back_squat", medianBefore: 100, medianAfter: 220, ratio: 2.2 }],
};

/** A clean athlete with legacy rows: the base case each test perturbs. */
const clean = {
  legacyWeightRows: 40,
  legacyDistanceRows: 12,
  weightSwitch: null,
  distanceSwitch: null,
  weightPlausibility: "consistent",
} as const;

describe("verdictFor — the gate a backfill is allowed to write through", () => {
  it("clears an athlete with legacy rows and no evidence of a switch", () => {
    expect(verdictFor(clean)).toBe("safe_to_stamp");
  });

  it("blocks an athlete whose weights show a switch", () => {
    expect(verdictFor({ ...clean, weightSwitch: A_SWITCH })).toBe("needs_split");
  });

  it("blocks an athlete whose DISTANCES show a switch even when weights look fine", () => {
    // A km -> miles toggle moves distances by 3.28 and leaves weights alone, so
    // an athlete can be clean on one axis and corrupt on the other.
    expect(verdictFor({ ...clean, distanceSwitch: A_SWITCH })).toBe("needs_split");
  });

  it("blocks an athlete whose weights do not look like the unit they claim", () => {
    expect(verdictFor({ ...clean, weightPlausibility: "suspect" })).toBe("needs_review");
  });

  it("prefers needs_split over needs_review when both fire", () => {
    // The ordering claim made in verdictFor's own comment. A detected boundary
    // is direct evidence with a DATE attached; the plausibility band is a
    // heuristic with none. Reporting the weaker one would cost whoever picks
    // this up the single most useful fact about the athlete.
    expect(verdictFor({ ...clean, weightSwitch: A_SWITCH, weightPlausibility: "suspect" })).toBe(
      "needs_split",
    );
  });

  it("says nothing_to_do when there are no legacy rows at all", () => {
    expect(verdictFor({ ...clean, legacyWeightRows: 0, legacyDistanceRows: 0 })).toBe(
      "nothing_to_do",
    );
  });

  it("says nothing_to_do even when the athlete looks suspect, if there is nothing to stamp", () => {
    // An athlete whose whole history is already stamped cannot be harmed by a
    // backfill, however odd their numbers look. Returning needs_review here
    // would put a permanent un-actionable entry on the operator's list.
    expect(
      verdictFor({
        ...clean,
        legacyWeightRows: 0,
        legacyDistanceRows: 0,
        weightPlausibility: "suspect",
      }),
    ).toBe("nothing_to_do");
  });

  it("still has something to do when only ONE of the two row counts is zero", () => {
    expect(verdictFor({ ...clean, legacyWeightRows: 0 })).toBe("safe_to_stamp");
    expect(verdictFor({ ...clean, legacyDistanceRows: 0 })).toBe("safe_to_stamp");
  });

  it("treats an unknown plausibility as no objection", () => {
    // "unknown" is what the band returns inside the 60-140 overlap and below
    // five data points. It is an absence of evidence, and must not be read as
    // evidence of a problem — that would block most small accounts forever.
    expect(verdictFor({ ...clean, weightPlausibility: "unknown" })).toBe("safe_to_stamp");
  });
});

describe("isSafeToStamp", () => {
  const report = (verdict: LegacyUnitVerdict): AthleteUnitReport => ({
    userId: "u1",
    currentWeightUnit: "kg",
    currentDistanceUnit: "km",
    ...clean,
    verdict,
  });

  it("admits only safe_to_stamp", () => {
    expect(isSafeToStamp(report("safe_to_stamp"))).toBe(true);
  });

  it("refuses every other verdict", () => {
    // Written as an exhaustive list rather than three separate assertions so a
    // NEW verdict added to the union fails to compile here until someone
    // decides, deliberately, which side of the gate it belongs on.
    const blocked: readonly LegacyUnitVerdict[] = ["needs_split", "needs_review", "nothing_to_do"];
    for (const verdict of blocked) {
      expect(isSafeToStamp(report(verdict))).toBe(false);
    }
  });
});
