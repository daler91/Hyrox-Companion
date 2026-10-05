import { addDaysToISODate as addDays } from "@shared/dateUtils";
import type { WorkoutLog } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { calculateTrainingLoad } from "../trainingLoadService";
import { makeWorkoutLog } from "../trainingLoadService.testHelpers";

/**
 * C11 (CODEBASE_ANALYSIS_2026-10-03): both EWMAs used to be seeded with the
 * first logged day's UTSS, and that one day still made up ~40% of chronic load
 * when the ACWR gate opened on day 14. Driven through the real
 * `calculateTrainingLoad`, because the zone the governor acts on is what the
 * athlete sees.
 */
const FIRST_DAY = "2026-04-01";

/** 60 min at RPE 6: 79.2 UTSS, the steady day every scenario returns to. */
function steadyLog(date: string): WorkoutLog {
  return makeWorkoutLog({ id: `steady-${date}`, date, duration: 60, rpe: 6 });
}

/** The ACWR zone on each day from the gate opening (day 14) to `lastDay`. */
function gatedZones(logs: WorkoutLog[], lastDay: number): { date: string; zone: string }[] {
  const currentDate = addDays(FIRST_DAY, lastDay - 1);
  const { dailyLoads } = calculateTrainingLoad(logs, [], [], { currentDate });
  return dailyLoads
    .filter((d) => d.date >= addDays(FIRST_DAY, 13))
    .map((d) => ({ date: d.date, zone: d.zone }));
}

/** A first session of the given size, then a steady day every day to `lastDay`. */
function firstSessionThenSteady(first: Partial<WorkoutLog>, lastDay: number): WorkoutLog[] {
  const logs = [makeWorkoutLog({ id: "first", date: FIRST_DAY, ...first })];
  for (let day = 2; day <= lastDay; day++) logs.push(steadyLog(addDays(FIRST_DAY, day - 1)));
  return logs;
}

describe("applyLoadDynamics — the first logged day does not dominate the baseline (C11)", () => {
  it("does not call a steady athlete undertrained because their first session was long", () => {
    // 3 h at RPE 8 (338 UTSS), then 79 UTSS a day. The seeded EWMAs read 0.47
    // on day 14 and were still "undertraining" on day 28.
    const zones = gatedZones(firstSessionThenSteady({ duration: 180, rpe: 8 }, 28), 28);
    expect(zones).toHaveLength(15);
    for (const { date, zone } of zones) expect(zone, date).toBe("sweet_spot");
  });

  it("does not put a steady athlete in yellow because their first session was short", () => {
    // 15 min at RPE 3 (12 UTSS), then 79 UTSS a day. The seeded EWMAs read 1.48
    // ("yellow") when the gate opened.
    const zones = gatedZones(firstSessionThenSteady({ duration: 15, rpe: 3 }, 28), 28);
    for (const { date, zone } of zones) expect(zone, date).toBe("sweet_spot");
  });

  it("reads a four-day-a-week athlete as steady, not undertrained", () => {
    // Seeding with a training day overstated the daily mean of anyone who takes
    // rest days, so this pattern dipped to 0.70 ("undertraining") every week.
    const trainingDays = new Set([0, 2, 4, 5]);
    const logs: WorkoutLog[] = [];
    for (let offset = 0; offset < 42; offset++) {
      if (trainingDays.has(offset % 7)) logs.push(steadyLog(addDays(FIRST_DAY, offset)));
    }
    const zones = gatedZones(logs, 42);
    for (const { date, zone } of zones) expect(zone, date).toBe("sweet_spot");
  });

  it("keeps the 14-day gate: no ratio or Form before it", () => {
    const logs = firstSessionThenSteady({ duration: 60, rpe: 6 }, 13);
    const { dailyLoads } = calculateTrainingLoad(logs, [], [], {
      currentDate: addDays(FIRST_DAY, 12),
    });
    const history = dailyLoads.filter((d) => d.date >= FIRST_DAY);
    expect(history).toHaveLength(13);
    for (const day of history) {
      expect(day.acwr, day.date).toBeNull();
      expect(day.tsb, day.date).toBeNull();
      expect(day.zone, day.date).toBe("insufficient_data");
      // The EWMAs themselves are reported from the first day, already on the
      // athlete's real scale rather than ramping up from zero.
      expect(day.chronicEwma, day.date).toBe(79.2);
    }
  });
});
