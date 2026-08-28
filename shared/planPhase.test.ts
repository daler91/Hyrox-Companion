import { describe, expect, it } from "vitest";

import {
  computeCurrentWeek,
  computePlanPhase,
  formatPhaseName,
  isPlanEnded,
  PLAN_PHASE_ORDER,
  planWeekForDisplay,
} from "./planPhase";

describe("computeCurrentWeek", () => {
  it("defaults to week 1 when there is no start date", () => {
    expect(computeCurrentWeek(null, 12, "2026-06-15")).toBe(1);
    expect(computeCurrentWeek(undefined, 12, "2026-06-15")).toBe(1);
  });

  it("stays in week 1 for the first six days of the block", () => {
    expect(computeCurrentWeek("2026-01-01", 12, "2026-01-01")).toBe(1);
    expect(computeCurrentWeek("2026-01-01", 12, "2026-01-06")).toBe(1);
  });

  it("rolls into week 2 on day 7", () => {
    expect(computeCurrentWeek("2026-01-01", 12, "2026-01-08")).toBe(2);
  });

  it("clamps a plan that hasn't started yet to week 1 rather than going negative", () => {
    expect(computeCurrentWeek("2026-06-01", 12, "2026-05-25")).toBe(1);
  });

  it("does NOT clamp to totalWeeks — a plan that ended months ago reports its true week (audit H15)", () => {
    // 2026-01-01 to 2026-04-01 is 90 days into a 4-week block: week 13, not
    // clamped back down to 4. Clamping here is what locked the coach into
    // "reduce work only" forever, because computePlanPhase used to read
    // currentWeek >= totalWeeks as race_week with no way to tell "ended" apart.
    expect(computeCurrentWeek("2026-01-01", 4, "2026-04-01")).toBe(13);
  });
});

describe("planWeekForDisplay", () => {
  it("clamps a week past the end of the block down to the last week", () => {
    expect(planWeekForDisplay(13, 4)).toBe(4);
  });

  it("clamps a non-positive week up to week 1", () => {
    expect(planWeekForDisplay(0, 12)).toBe(1);
    expect(planWeekForDisplay(-3, 12)).toBe(1);
  });

  it("passes an in-range week through unchanged", () => {
    expect(planWeekForDisplay(6, 12)).toBe(6);
  });

  it("floors totalWeeks at 1 so a 0-week block still shows week 1", () => {
    expect(planWeekForDisplay(1, 0)).toBe(1);
  });
});

describe("isPlanEnded", () => {
  it("is true once the current week is past the block", () => {
    expect(isPlanEnded(13, 4)).toBe(true);
  });

  it("is false on the block's final week", () => {
    expect(isPlanEnded(4, 4)).toBe(false);
  });

  it("is false inside the block", () => {
    expect(isPlanEnded(2, 4)).toBe(false);
  });

  it("is false when totalWeeks is not a real block", () => {
    expect(isPlanEnded(1, 0)).toBe(false);
  });
});

describe("computePlanPhase", () => {
  it("returns undefined for a non-positive totalWeeks or currentWeek", () => {
    expect(computePlanPhase(0, 1)).toBeUndefined();
    expect(computePlanPhase(-1, 1)).toBeUndefined();
    expect(computePlanPhase(12, 0)).toBeUndefined();
    expect(computePlanPhase(12, -2)).toBeUndefined();
  });

  it("returns undefined for a week past the end of the block (audit H15)", () => {
    // Previously unreachable because computeCurrentWeek clamped its result to
    // totalWeeks, so a currentWeek this large could never be passed in — and
    // the caller had no way to distinguish "still in the block" from "ended".
    expect(computePlanPhase(4, 13)).toBeUndefined();
  });

  it("buckets a 12-week block through early / build / peak / taper / race_week", () => {
    expect(computePlanPhase(12, 1)).toMatchObject({ phaseLabel: "early", progressPct: 4 });
    expect(computePlanPhase(12, 4)).toMatchObject({ phaseLabel: "build", progressPct: 29 });
    expect(computePlanPhase(12, 8)).toMatchObject({ phaseLabel: "peak", progressPct: 63 });
    expect(computePlanPhase(12, 12)).toMatchObject({ phaseLabel: "race_week" });
  });

  it("always calls the final week race_week regardless of the percentage band", () => {
    expect(computePlanPhase(12, 12)!.phaseLabel).toBe("race_week");
    expect(computePlanPhase(1, 1)!.phaseLabel).toBe("race_week");
  });

  it("forces taper on the week before the race even when the percentage band hasn't reached 85%", () => {
    // An 8-week block's week 7 sits at 81% under the midpoint measure — under
    // 85 — but without this structural rule an 8-week plan would jump straight
    // from peak to race_week with no taper at all.
    const phase = computePlanPhase(8, 7)!;
    expect(phase.progressPct).toBeLessThan(85);
    expect(phase.phaseLabel).toBe("taper");
  });

  it("skips the forced pre-race taper for a block shorter than 4 weeks", () => {
    // A 3-week block's week 2 (totalWeeks - 1) is NOT forced into taper — a
    // third of a 3-week plan spent tapering would be too much.
    expect(computePlanPhase(3, 2)).toMatchObject({ phaseLabel: "build", progressPct: 50 });
    expect(computePlanPhase(3, 3)).toMatchObject({ phaseLabel: "race_week" });
  });

  it("reaches taper by percentage alone on a long enough block", () => {
    // 12-week block, week 11: 88% and also one week before the race — both
    // rules agree here.
    expect(computePlanPhase(12, 11)).toMatchObject({ phaseLabel: "taper", progressPct: 88 });
  });

  it("echoes back currentWeek and totalWeeks unchanged", () => {
    expect(computePlanPhase(12, 8)).toMatchObject({ currentWeek: 8, totalWeeks: 12 });
  });

  it("lists the phases still ahead, in order, excluding the current one", () => {
    expect(computePlanPhase(12, 8)!.remainingPhases).toEqual(["taper", "race_week"]);
    expect(computePlanPhase(12, 1)!.remainingPhases).toEqual(["build", "peak", "taper", "race_week"]);
    expect(computePlanPhase(12, 12)!.remainingPhases).toEqual([]);
  });

  it("returns a fresh remainingPhases array each call rather than aliasing PLAN_PHASE_ORDER", () => {
    const phase = computePlanPhase(12, 1)!;
    phase.remainingPhases.push("race_week");
    expect(PLAN_PHASE_ORDER).toEqual(["early", "build", "peak", "taper", "race_week"]);
  });
});

describe("formatPhaseName", () => {
  it("special-cases race_week to two capitalised words", () => {
    expect(formatPhaseName("race_week")).toBe("Race week");
  });

  it("capitalises every other phase", () => {
    expect(formatPhaseName("early")).toBe("Early");
    expect(formatPhaseName("build")).toBe("Build");
    expect(formatPhaseName("peak")).toBe("Peak");
    expect(formatPhaseName("taper")).toBe("Taper");
  });
});
