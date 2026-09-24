import { describe, expect, it } from "vitest";

import { buildPlanOutline } from "../planBlueprint";
import type { EngineSet } from "./loadMath";
import {
  buildRunPaceZones,
  buildRunVolumeBaseline,
  buildRunVolumeTargets,
  collectRunEfforts,
  type EngineRunLog,
  paceAtFraction,
  type RunEffort,
  type RunVolumeInput,
  vdotFromEffort,
} from "./running";

function run(date: string, km: number, minutes: number, overrides: Partial<EngineRunLog> = {}) {
  return {
    id: `run-${date}`,
    date,
    focus: "Run",
    distanceMeters: km * 1000,
    duration: minutes,
    avgSpeed: (km * 1000) / (minutes * 60),
    ...overrides,
  } satisfies EngineRunLog;
}

function effort(date: string, km: number, minutes: number): RunEffort {
  return { date, meters: km * 1000, seconds: minutes * 60 };
}

describe("VDOT", () => {
  it("matches Daniels' tables for known performances", () => {
    expect(vdotFromEffort(10_000, 50 * 60)).toBeCloseTo(40, 0);
    expect(vdotFromEffort(5000, 20 * 60)).toBeCloseTo(49.8, 1);
  });

  it("solves the zones back to Daniels' paces (VDOT 50 threshold ≈ 4:15/km)", () => {
    expect(paceAtFraction(50, 0.88)).toBeCloseTo(255, 0);
    expect(paceAtFraction(50, 0.975)).toBeCloseTo(235, 0);
  });
});

describe("collectRunEfforts", () => {
  it("counts a synced run once, not again through its synthesised set", () => {
    const synced = run("2026-09-10", 5, 25);
    const syntheticSet: EngineSet = {
      exerciseName: "run",
      workoutLogId: synced.id,
      date: synced.date,
      distance: 5000,
      distanceUnit: "m",
      time: 25,
    };
    expect(collectRunEfforts([synced], [syntheticSet], "km")).toHaveLength(1);
  });

  it("reads intervals from the sets of a log that has no distance of its own", () => {
    const log: EngineRunLog = { id: "intervals", date: "2026-09-12", focus: "Intervals" };
    const rep = (n: number): EngineSet => ({
      exerciseName: "interval_run",
      workoutLogId: "intervals",
      date: log.date,
      distance: 1000,
      distanceUnit: "m",
      time: 4.5 + n / 100,
    });
    expect(collectRunEfforts([log], [rep(0), rep(1), rep(2)], "km")).toHaveLength(3);
  });

  it("drops rides, implausible speeds and sessions that don't count as training", () => {
    const efforts = collectRunEfforts(
      [
        run("2026-09-01", 30, 60, { focus: "Ride" }),
        run("2026-09-02", 30, 60, { focus: "Run" }), // 8.3 m/s: a mis-tagged ride
        run("2026-09-03", 5, 30, { countsAsTraining: false }),
        run("2026-09-04", 5, 30),
      ],
      [],
      "km",
    );
    expect(efforts.map((e) => e.date)).toEqual(["2026-09-04"]);
  });

  it("reads a miles athlete's stored feet as metres", () => {
    const [only] = collectRunEfforts(
      [{ id: "m", date: "2026-09-12", focus: "Tempo" }],
      [
        {
          exerciseName: "tempo_run",
          workoutLogId: "m",
          date: "2026-09-12",
          distance: 16404,
          distanceUnit: "ft",
          time: 25,
        },
      ],
      "miles",
    );
    expect(only?.meters).toBeCloseTo(5000, -1);
  });
});

describe("buildRunPaceZones", () => {
  it("fits the zones to the best believable effort", () => {
    const zones = buildRunPaceZones([
      effort("2026-09-02", 8, 45),
      effort("2026-09-06", 5, 24),
      effort("2026-09-10", 12, 70),
    ]);
    expect(zones?.basis).toEqual(effort("2026-09-06", 5, 24));
    expect(zones?.vdot).toBeCloseTo(40.2, 1);
    // Easy is slower than steady, steady slower than threshold, and so on.
    expect(zones!.easy.slow).toBeGreaterThan(zones!.easy.fast);
    expect(zones!.easy.fast).toBeGreaterThan(zones!.steady);
    expect(zones!.steady).toBeGreaterThan(zones!.threshold);
    expect(zones!.threshold).toBeGreaterThan(zones!.interval);
    expect(zones!.interval).toBeGreaterThan(zones!.repetition);
  });

  it("ignores a 'best' far above the athlete's typical run", () => {
    const zones = buildRunPaceZones([
      effort("2026-09-02", 8, 45),
      effort("2026-09-06", 8, 44),
      effort("2026-09-08", 8, 46),
      effort("2026-09-10", 20, 42), // 28.6 km/h
    ]);
    expect(zones?.basis.date).toBe("2026-09-06");
  });

  it("needs two efforts of at least 800 m and 3 minutes", () => {
    expect(buildRunPaceZones([effort("2026-09-02", 5, 25)])).toBeNull();
    expect(
      buildRunPaceZones([effort("2026-09-02", 0.4, 1.5), effort("2026-09-03", 0.4, 1.5)]),
    ).toBeNull();
  });
});

describe("buildRunVolumeBaseline", () => {
  it("averages the last four weeks and ignores older runs", () => {
    const baseline = buildRunVolumeBaseline(
      [
        effort("2026-07-01", 30, 180),
        effort("2026-09-01", 8, 45),
        effort("2026-09-08", 12, 70),
        effort("2026-09-15", 8, 45),
        effort("2026-09-20", 12, 70),
      ],
      "2026-09-20",
    );
    expect(baseline).toEqual({ weeklyKm: 10, longestRunKm: 12, runsPerWeek: 1 });
  });

  it("is null with fewer than two recent runs", () => {
    expect(buildRunVolumeBaseline([effort("2026-09-20", 8, 45)], "2026-09-20")).toBeNull();
  });
});

describe("buildRunVolumeTargets", () => {
  const base: RunVolumeInput = {
    lens: "running",
    experience: "intermediate",
    goal: "Sub-50 10k",
    outline: buildPlanOutline(12),
    baseline: { weeklyKm: 15, longestRunKm: 10, runsPerWeek: 3 },
    hasRace: true,
  };

  it("has no running backbone for a strength goal", () => {
    expect(buildRunVolumeTargets({ ...base, lens: "strength" })).toEqual([]);
  });

  it("opens at most 30% above what the athlete runs now", () => {
    const [week1] = buildRunVolumeTargets(base);
    expect(week1.weeklyKm).toBe(19.5);
  });

  it("never cuts an athlete who already runs more than the goal's default", () => {
    const [week1] = buildRunVolumeTargets({
      ...base,
      baseline: { weeklyKm: 42, longestRunKm: 18, runsPerWeek: 5 },
    });
    expect(week1.weeklyKm).toBe(42);
  });

  it("grows by at most 8% a loading week, deloads to 75% and tapers to the race", () => {
    const weeks = buildRunVolumeTargets(base);
    for (let i = 1; i < weeks.length; i++) {
      const [previous, week] = [weeks[i - 1], weeks[i]];
      if (!week.deload && !previous.deload) {
        expect(week.weeklyKm).toBeLessThanOrEqual(previous.weeklyKm * 1.08 + 0.5);
      }
    }
    const deload = weeks[3];
    expect(deload.deload).toBe(true);
    expect(deload.weeklyKm).toBeCloseTo(weeks[2].weeklyKm * 0.75, 0);
    expect(weeks.at(-2)!.weeklyKm).toBeLessThan(weeks.at(-3)!.weeklyKm);
    // Race week: the race is the long run.
    expect(weeks.at(-1)!.longRunKm).toBe(0);
  });

  it("keeps a long run the athlete already does, even in a low-volume week", () => {
    const [week1] = buildRunVolumeTargets({
      ...base,
      lens: "hyrox",
      baseline: { weeklyKm: 9, longestRunKm: 10, runsPerWeek: 1.3 },
    });
    // Half of an ~11.5 km week would be ~6 km; they already run 10.
    expect(week1.longRunKm).toBe(9);
  });

  it("keeps the long run to at most half the week and within the goal's cap", () => {
    const marathon = buildRunVolumeTargets({
      ...base,
      experience: "advanced",
      goal: "Marathon PB",
      baseline: { weeklyKm: 70, longestRunKm: 34, runsPerWeek: 6 },
    });
    const fiveK = buildRunVolumeTargets({ ...base, goal: "Fast 5k" });
    for (const week of [...marathon, ...fiveK]) {
      expect(week.longRunKm).toBeLessThanOrEqual(week.weeklyKm / 2 + 0.25);
    }
    expect(Math.max(...marathon.map((week) => week.longRunKm))).toBe(32);
    expect(Math.max(...fiveK.map((week) => week.longRunKm))).toBeLessThanOrEqual(12);
  });
});
