import { computePlanPhase } from "@shared/planPhase";
import { describe, expect, it } from "vitest";

import { buildPlanOutline, describeProgramBlueprintLines, planDeloadWeeks } from "./planBlueprint";

describe("planDeloadWeeks", () => {
  it.each([
    [1, []],
    [5, []],
    [6, [3]],
    [8, [4]],
    [11, [6]],
    [12, [4, 8]],
    [16, [4, 8, 12]],
    [24, [4, 8, 12, 16, 20]],
  ])("a %i-week plan deloads in weeks %j", (totalWeeks, expected) => {
    expect(planDeloadWeeks(totalWeeks)).toEqual(expected);
  });

  it("never deloads inside the final three weeks, which already unload", () => {
    for (let totalWeeks = 1; totalWeeks <= 24; totalWeeks++) {
      for (const week of planDeloadWeeks(totalWeeks))
        expect(week).toBeLessThanOrEqual(totalWeeks - 3);
    }
  });
});

describe("buildPlanOutline", () => {
  it("uses the coach's own phase rule for every week", () => {
    for (const entry of buildPlanOutline(12)) {
      expect(entry.phase).toBe(computePlanPhase(12, entry.week)?.phaseLabel);
    }
  });

  it("starts a new block the week after each deload", () => {
    expect(buildPlanOutline(12).map((entry) => entry.block)).toEqual([
      1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3,
    ]);
  });
});

describe("describeProgramBlueprintLines", () => {
  const primaryLifts = [
    { slot: "squat", exercise: "back_squat", sessions: 9 },
    { slot: "hinge", exercise: "romanian_deadlift", sessions: 0 },
  ] as const;

  function text(
    range: { startWeek: number; endWeek: number },
    totalWeeks = 12,
    hasRace = true,
  ): string {
    return describeProgramBlueprintLines({ totalWeeks, range, hasRace, primaryLifts }).join("\n");
  }

  it("gives every chunk the same blocks and primary lifts", () => {
    for (const range of [
      { startWeek: 1, endWeek: 2 },
      { startWeek: 7, endWeek: 8 },
    ]) {
      const chunk = text(range);
      expect(chunk).toContain("weeks 1-4 = block 1 · weeks 5-8 = block 2 · weeks 9-12 = block 3");
      expect(chunk).toContain(
        "Primary lifts for the whole plan: squat: back_squat (athlete's own, 9 sessions) · hinge: romanian_deadlift.",
      );
    }
  });

  it("labels only the chunk's own weeks, and explains a deload only where one falls", () => {
    expect(text({ startWeek: 3, endWeek: 4 })).toContain(
      "week 3 = EARLY (block 1); week 4 = BUILD, DELOAD (block 1).",
    );
    expect(text({ startWeek: 3, endWeek: 4 })).toContain("DELOAD week:");
    expect(text({ startWeek: 5, endWeek: 6 })).not.toContain("DELOAD week:");
  });

  it("calls the last weeks of a race plan the taper and race week", () => {
    expect(text({ startWeek: 11, endWeek: 12 })).toContain(
      "week 11 = TAPER (block 3); week 12 = RACE WEEK (block 3).",
    );
  });

  it("keeps a non-race plan's final week light without calling it race week", () => {
    const chunk = text({ startWeek: 11, endWeek: 12 }, 12, false);
    expect(chunk).toContain("week 12 = FINAL WEEK (block 3)");
    expect(chunk).toContain("FINAL WEEK: the in-app coach reviews a plan's last week as a taper");
    expect(chunk).not.toContain("RACE WEEK");
  });

  it("leaves a short non-race plan unperiodised", () => {
    const chunk = text({ startWeek: 1, endWeek: 2 }, 2, false);
    expect(chunk).not.toContain("Weeks in this chunk");
    expect(chunk).not.toContain("FINAL WEEK");
    expect(chunk).not.toContain("Blocks:");
  });

  it("omits the primary-lift line when there are none", () => {
    const chunk = describeProgramBlueprintLines({
      totalWeeks: 8,
      range: { startWeek: 1, endWeek: 2 },
      hasRace: true,
      primaryLifts: [],
    }).join("\n");
    expect(chunk).not.toContain("Primary lifts for the whole plan");
    expect(chunk).toContain("PROGRAM BLUEPRINT");
  });
});
