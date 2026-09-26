import type { SessionGrade } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { buildSessionGradeRollups, type RollupDay } from "./rollups";
import { makeGrade } from "./testFixtures";

function days(weeks: number, perWeek: RollupDay[] = [{ weekNumber: 0, gradeable: true, mentionsDeload: false }]): RollupDay[] {
  return Array.from({ length: weeks }, (_, i) => perWeek.map((day) => ({ ...day, weekNumber: i + 1 }))).flat();
}

describe("buildSessionGradeRollups", () => {
  it("lays a 12-week plan out in the generator's blocks, deloading on weeks 4 and 8", () => {
    const { weeks, blocks } = buildSessionGradeRollups({
      totalWeeks: 12,
      startDate: "2026-06-03",
      days: days(12),
      grades: [],
    });
    expect(weeks).toHaveLength(12);
    expect(weeks.filter((week) => week.deload).map((week) => week.weekNumber)).toEqual([4, 8]);
    expect(blocks.map((block) => [block.block, block.firstWeek, block.lastWeek])).toEqual([
      [1, 1, 4],
      [2, 5, 8],
      [3, 9, 12],
    ]);
    // Weeks start on the plan's week-one Monday.
    expect(weeks[0]?.weekStart).toBe("2026-06-01");
    expect(weeks[1]?.weekStart).toBe("2026-06-08");
    expect(blocks[0]?.phases).toEqual(["early", "build"]);
    expect(blocks[2]?.phases).toContain("race_week");
  });

  it("counts each verdict under its week, block and the plan totals", () => {
    const grades: SessionGrade[] = [
      makeGrade({ workoutLogId: "a", weekNumber: 1, intent: "easy", verdict: "on_target" }),
      makeGrade({ workoutLogId: "b", weekNumber: 1, intent: "easy", verdict: "too_hard" }),
      makeGrade({ workoutLogId: "c", weekNumber: 2, intent: "threshold", verdict: "drifted_harder" }),
      makeGrade({ workoutLogId: "d", weekNumber: 2, intent: "threshold", verdict: "on_target" }),
      makeGrade({ workoutLogId: "e", weekNumber: 2, intent: "threshold", verdict: "inconclusive", dataSource: "summary", streamStatus: "pending" }),
    ];
    const { weeks, blocks, totals } = buildSessionGradeRollups({
      totalWeeks: 4,
      startDate: null,
      days: days(4, [
        { weekNumber: 0, gradeable: true, mentionsDeload: false },
        { weekNumber: 0, gradeable: true, mentionsDeload: false },
        { weekNumber: 0, gradeable: false, mentionsDeload: false },
      ]),
      grades,
    });
    expect(weeks[0]?.counts).toMatchObject({ graded: 2, onTarget: 1, onTargetRate: 0.5, easyTooHard: 1, plannedGradeable: 2 });
    expect(weeks[0]?.counts.easy).toMatchObject({ onTarget: 1, tooHard: 1 });
    expect(weeks[1]?.counts).toMatchObject({ graded: 2, driftedHarder: 1, pending: 1 });
    expect(weeks[1]?.counts.threshold).toMatchObject({ onTarget: 1, driftedHarder: 1, inconclusive: 1 });
    expect(weeks[2]?.counts.onTargetRate).toBeNull();
    expect(weeks[0]?.weekStart).toBeNull();
    // A short plan is one block.
    expect(blocks).toHaveLength(1);
    expect(totals).toMatchObject({ graded: 4, onTarget: 2, onTargetRate: 0.5, plannedGradeable: 8 });
  });

  it("leaves out logs that do not count toward the rollup", () => {
    const { totals } = buildSessionGradeRollups({
      totalWeeks: 2,
      startDate: null,
      days: days(2),
      grades: [
        makeGrade({ workoutLogId: "kept", weekNumber: 1 }),
        makeGrade({ workoutLogId: "second-log", weekNumber: 1, verdict: "too_hard", countsInRollup: false }),
      ],
    });
    expect(totals).toMatchObject({ graded: 1, onTarget: 1, easyTooHard: 0 });
  });

  it("takes deloads from the plan's own text when it names them", () => {
    const planDays = days(8).map((day) => ({ ...day, mentionsDeload: day.weekNumber === 3 }));
    const { weeks, blocks } = buildSessionGradeRollups({ totalWeeks: 8, startDate: null, days: planDays, grades: [] });
    expect(weeks.filter((week) => week.deload).map((week) => week.weekNumber)).toEqual([3]);
    expect(blocks.map((block) => [block.firstWeek, block.lastWeek])).toEqual([
      [1, 3],
      [4, 8],
    ]);
  });

  it("keeps a plan's own week numbering when it starts at zero", () => {
    const planDays = [0, 1, 2].map((weekNumber) => ({ weekNumber, gradeable: true, mentionsDeload: false }));
    const { weeks } = buildSessionGradeRollups({
      totalWeeks: 3,
      startDate: null,
      days: planDays,
      grades: [makeGrade({ weekNumber: 0 })],
    });
    expect(weeks.map((week) => week.weekNumber)).toEqual([0, 1, 2]);
    expect(weeks[0]?.counts.onTarget).toBe(1);
  });
});
