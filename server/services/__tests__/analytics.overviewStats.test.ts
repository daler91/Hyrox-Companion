/**
 * The Overview tab's averaged cards: Avg / Week (C6) and Avg Adherence (C7),
 * CODEBASE_ANALYSIS_2026-10-03.
 */

import { describe, expect, it } from "vitest";

import { calculateTrainingOverview, computeAdherencePct } from "../analyticsService";
import { makeWorkoutLog } from "../trainingLoadService.testHelpers";

// Avg / Week divided by the Monday-weeks the window touched, so a 30-day
// window counted its partial first week and the in-progress current week as
// whole weeks, and the previous window was not zero-filled at its edges.
describe("Avg / Week over the selected period's real length (C6)", () => {
  // 2026-08-30 (Sun) .. 2026-09-28 (Mon): 30 days, touching six Monday-weeks.
  const PERIOD = { from: "2026-08-30", to: "2026-09-28" };
  // The equal-length window before it, which the loader fetches previous logs for.
  const PREVIOUS = { from: "2026-07-31", to: "2026-08-29" };

  /** Every Mon/Tue/Thu/Sat in [from, to]: a steady four-a-week athlete. */
  const steadyLogs = (from: string, to: string, prefix: string) => {
    const logs = [];
    for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      if ([1, 2, 4, 6].includes(d.getUTCDay())) {
        const date = d.toISOString().split("T")[0];
        logs.push(makeWorkoutLog({ id: `${prefix}-${date}`, date }));
      }
    }
    return logs;
  };

  it("reports a steady four-a-week athlete as 4.0, not 2.8", () => {
    const logs = steadyLogs(PERIOD.from, PERIOD.to, "c");
    expect(logs).toHaveLength(17);

    const result = calculateTrainingOverview(logs, [], undefined, { period: PERIOD });

    // 17 workouts over 30/7 weeks. Divided by the six Monday-weeks this read 2.8.
    expect(result.currentStats.avgPerWeek).toBe(4);
    // The chart still gets every Monday-week, rest weeks included.
    expect(result.weeklySummaries).toHaveLength(6);
  });

  it("measures the previous period over its own full length too", () => {
    // Nine sessions in the middle fortnight of the previous 30 days, after an
    // injured start: its leading and trailing rest weeks used to drop out of
    // the denominator, reading 4.5/week instead of 2.1.
    const previous = [
      ...steadyLogs("2026-08-10", "2026-08-23", "p"),
      makeWorkoutLog({ id: "p-extra", date: "2026-08-23" }),
    ];
    expect(previous).toHaveLength(9);
    expect(previous.every((log) => log.date >= PREVIOUS.from && log.date <= PREVIOUS.to)).toBe(true);

    const result = calculateTrainingOverview(steadyLogs(PERIOD.from, PERIOD.to, "c"), [], previous, { period: PERIOD });

    expect(result.previousStats?.avgPerWeek).toBe(2.1);
  });

  it("keeps the week count for an open-ended ('all time') view", () => {
    const logs = [
      makeWorkoutLog({ id: "w1", date: "2026-01-13" }),
      makeWorkoutLog({ id: "w2", date: "2026-01-14" }),
      makeWorkoutLog({ id: "w3", date: "2026-01-20" }),
    ];

    expect(calculateTrainingOverview(logs, []).currentStats.avgPerWeek).toBe(1.5);
  });
});

// Avg Adherence summed compliancePct over every LOG but divided by due plan
// DAYS, a count that also leaves out absence-covered days.
describe("Avg Adherence counts plan days, not logs (C7)", () => {
  it("counts each plan day once, however many logs are linked to it", () => {
    // An AM and a PM log against one plan day used to add both percentages
    // against a single due session: (100 + 80 + 100) / 2 = 140%.
    const logs = [
      { compliancePct: 100, planDayId: "day-1" },
      { compliancePct: 80, planDayId: "day-1" },
      { compliancePct: 100, planDayId: "day-2" },
    ];
    expect(computeAdherencePct(logs, 2)).toBe(100);
  });

  it("takes a plan day's best log, not the sum of its logs, below the cap too", () => {
    // Summing both logs would read (50 + 40) / 2 = 45%; the one day done at 50%
    // out of two due is 25%.
    const logs = [
      { compliancePct: 50, planDayId: "day-1" },
      { compliancePct: 40, planDayId: "day-1" },
    ];
    expect(computeAdherencePct(logs, 2)).toBe(25);
  });

  it("never reports more than 100%", () => {
    // A session completed during a declared travel week is held out of the due
    // count but still carries its compliancePct: 12 due + 3 excused, all done
    // in full, read 125%.
    const logs = Array.from({ length: 15 }, (_, i) => ({ compliancePct: 100, planDayId: `day-${i}` }));
    expect(computeAdherencePct(logs, 12)).toBe(100);
  });

  it("feeds the overview's card the same way", () => {
    const logs = [
      makeWorkoutLog({ id: "am", date: "2026-01-13", planDayId: "day-1", compliancePct: 100 }),
      makeWorkoutLog({ id: "pm", date: "2026-01-13", planDayId: "day-1", compliancePct: 90 }),
    ];

    expect(calculateTrainingOverview(logs, [], undefined, { dueSessionCount: 1 }).currentStats.avgCompliancePct).toBe(100);
  });
});
