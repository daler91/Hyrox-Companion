import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TrainingContext } from "../../gemini/index";
import {
  computeCurrentWeek,
  computeExerciseGaps,
  computePlanPhase,
  computeProgressionFlags,
  computeRpeTrend,
  computeWeeklyVolume,
} from "./coachingInsights";
import { makeExerciseSet as makeSet, makeTimelineEntry as makeEntry } from "./testFixtures";
import type { TimelineEntry } from "./types";

// Fixed "today" (a Monday) so toDateStr()/getMondayWeekBoundaries() are
// deterministic. 2026-06-15 is a Monday => thisMonday=2026-06-15,
// lastMonday=2026-06-08.
const TODAY = "2026-06-15";
const COMPLETED = "completed" as const;
const PLANNED = "planned" as const;
const BACK_SQUAT = "back_squat";

type RecentWorkout = TrainingContext["recentWorkouts"][number];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
});

afterEach(() => {
  vi.useRealTimers();
});

function makeRecent(overrides: Partial<RecentWorkout> = {}): RecentWorkout {
  return {
    date: "2026-06-10",
    focus: "",
    mainWorkout: "",
    status: COMPLETED,
    ...overrides,
  };
}

// recentWorkouts are ordered newest-first; the function reads slice(0,3) as
// the most recent three. Each rpe value becomes one workout.
function recentsWithRpe(rpes: Array<number | null>): RecentWorkout[] {
  return rpes.map((rpe, i) =>
    makeRecent({ date: `2026-06-${String(20 - i).padStart(2, "0")}`, rpe }),
  );
}

function gapsByStation(timeline: TimelineEntry[]): Record<string, number | null> {
  return Object.fromEntries(
    computeExerciseGaps(timeline).map((g) => [g.station, g.daysSinceLastTrained]),
  );
}

function weightEntry(date: string, weight: number): TimelineEntry {
  return makeEntry({ date, exerciseSets: [makeSet({ exerciseName: BACK_SQUAT, weight })] });
}

function timeEntry(date: string, time: number): TimelineEntry {
  return makeEntry({ date, exerciseSets: [makeSet({ exerciseName: "rowing", time })] });
}

describe("computeRpeTrend", () => {
  it("reports insufficient_data with no averages for fewer than 3 rated workouts", () => {
    expect(computeRpeTrend(recentsWithRpe([8, 7]))).toEqual({
      rpeTrend: "insufficient_data",
      fatigueFlag: false,
      undertrainingFlag: false,
    });
  });

  it("ignores workouts with null, zero, or negative rpe", () => {
    // Only 8, 9, 7 survive the rpe>0 filter -> exactly 3 -> avg only branch.
    const result = computeRpeTrend(recentsWithRpe([8, 0, null, 9, -2, 7]));
    expect(result).toEqual({
      rpeTrend: "insufficient_data",
      avgRpeLast3: 8,
      fatigueFlag: true,
      undertrainingFlag: false,
    });
  });

  it("returns avg + flags but no trend for exactly 3 rated workouts (no prior window)", () => {
    expect(computeRpeTrend(recentsWithRpe([6, 6, 6]))).toEqual({
      rpeTrend: "insufficient_data",
      avgRpeLast3: 6,
      fatigueFlag: false,
      undertrainingFlag: false,
    });
  });

  it("still has no trend with 4 rated workouts (prior window < 2)", () => {
    const result = computeRpeTrend(recentsWithRpe([9, 9, 9, 5]));
    expect(result).toEqual({
      rpeTrend: "insufficient_data",
      avgRpeLast3: 9,
      fatigueFlag: true,
      undertrainingFlag: false,
    });
  });

  it("flags a rising trend when recent load clearly exceeds the prior window", () => {
    expect(computeRpeTrend(recentsWithRpe([9, 9, 9, 7, 7]))).toEqual({
      rpeTrend: "rising",
      avgRpeLast3: 9,
      avgRpePrior3: 7,
      fatigueFlag: true,
      undertrainingFlag: false,
    });
  });

  it("flags a falling trend when recent load drops below the prior window", () => {
    expect(computeRpeTrend(recentsWithRpe([4, 4, 4, 8, 8]))).toEqual({
      rpeTrend: "falling",
      avgRpeLast3: 4,
      avgRpePrior3: 8,
      fatigueFlag: false,
      undertrainingFlag: true,
    });
  });

  it("treats a small positive difference (0.7) as stable, inside the dead zone", () => {
    // last3 = [8,8,8] -> 8.0; prior3 = [7,7,8] -> 7.3; diff = 0.7 (< 0.8).
    const result = computeRpeTrend(recentsWithRpe([8, 8, 8, 7, 7, 8]));
    expect(result.rpeTrend).toBe("stable");
    expect(result.avgRpeLast3).toBe(8);
    expect(result.avgRpePrior3).toBe(7.3);
  });

  it("treats a small negative difference (-0.7) as stable, inside the dead zone", () => {
    // last3 = [7,7,8] -> 7.3; prior3 = [8,8,8] -> 8.0; diff = -0.7 (> -0.8).
    const result = computeRpeTrend(recentsWithRpe([7, 7, 8, 8, 8, 8]));
    expect(result.rpeTrend).toBe("stable");
    expect(result.avgRpeLast3).toBe(7.3);
    expect(result.avgRpePrior3).toBe(8);
  });

  it("sets the fatigue flag at exactly 8 but not at 7", () => {
    expect(computeRpeTrend(recentsWithRpe([8, 8, 8])).fatigueFlag).toBe(true);
    expect(computeRpeTrend(recentsWithRpe([7, 7, 7])).fatigueFlag).toBe(false);
  });

  it("sets the undertraining flag at exactly 4 but not at 5", () => {
    expect(computeRpeTrend(recentsWithRpe([4, 4, 4])).undertrainingFlag).toBe(true);
    expect(computeRpeTrend(recentsWithRpe([5, 5, 5])).undertrainingFlag).toBe(false);
  });

  it("considers only the first six rated workouts", () => {
    // Trailing 1s are beyond the prior window and must not affect the result.
    const result = computeRpeTrend(recentsWithRpe([9, 9, 9, 7, 7, 7, 1, 1]));
    expect(result.avgRpeLast3).toBe(9);
    expect(result.avgRpePrior3).toBe(7);
  });
});

describe("computePlanPhase", () => {
  it("returns undefined for non-positive totalWeeks or currentWeek", () => {
    expect(computePlanPhase(0, 1)).toBeUndefined();
    expect(computePlanPhase(12, 0)).toBeUndefined();
    expect(computePlanPhase(-4, -1)).toBeUndefined();
  });

  it("labels the early phase below 25% progress", () => {
    const phase = computePlanPhase(12, 1);
    expect(phase).toEqual({
      currentWeek: 1,
      totalWeeks: 12,
      phaseLabel: "early",
      progressPct: 8,
      remainingPhases: ["build", "peak", "taper", "race_week"],
    });
  });

  it("enters build at exactly 25% and stays early at 24%", () => {
    expect(computePlanPhase(100, 25).phaseLabel).toBe("build");
    expect(computePlanPhase(100, 24).phaseLabel).toBe("early");
  });

  it("enters peak at exactly 60% and stays build at 59%", () => {
    expect(computePlanPhase(100, 60).phaseLabel).toBe("peak");
    expect(computePlanPhase(100, 59).phaseLabel).toBe("build");
  });

  it("enters taper at exactly 85% and stays peak at 84%", () => {
    expect(computePlanPhase(100, 85).phaseLabel).toBe("taper");
    expect(computePlanPhase(100, 84).phaseLabel).toBe("peak");
  });

  it("labels race_week on the final week and lists no remaining phases", () => {
    const phase = computePlanPhase(12, 12);
    expect(phase.phaseLabel).toBe("race_week");
    expect(phase.progressPct).toBe(100);
    expect(phase.remainingPhases).toEqual([]);
  });

  it("treats currentWeek beyond totalWeeks as race_week (overrides the percentage bands)", () => {
    const phase = computePlanPhase(4, 5);
    expect(phase.phaseLabel).toBe("race_week");
    expect(phase.progressPct).toBe(125);
  });
});

describe("computeWeeklyVolume", () => {
  it("counts completed workouts in this vs last Monday-week and flags an increase", () => {
    const volume = computeWeeklyVolume(
      [
        makeEntry({ date: "2026-06-15" }),
        makeEntry({ date: "2026-06-16" }),
        makeEntry({ date: "2026-06-20" }),
        makeEntry({ date: "2026-06-10" }),
      ],
      4,
    );
    expect(volume).toEqual({
      thisWeekCompleted: 3,
      lastWeekCompleted: 1,
      goal: 4,
      trend: "increasing",
    });
  });

  it("flags a decreasing trend", () => {
    const volume = computeWeeklyVolume(
      [
        makeEntry({ date: "2026-06-16" }),
        makeEntry({ date: "2026-06-09" }),
        makeEntry({ date: "2026-06-10" }),
      ],
      3,
    );
    expect(volume.trend).toBe("decreasing");
  });

  it("flags a stable trend when both weeks are equal (including zero)", () => {
    expect(computeWeeklyVolume([], 5).trend).toBe("stable");
    const volume = computeWeeklyVolume(
      [makeEntry({ date: "2026-06-16" }), makeEntry({ date: "2026-06-09" })],
      5,
    );
    expect(volume.trend).toBe("stable");
  });

  it("includes the Monday boundary in the current week and excludes the day before", () => {
    const volume = computeWeeklyVolume(
      [
        makeEntry({ date: "2026-06-15" }), // this Monday -> this week
        makeEntry({ date: "2026-06-14" }), // Sunday -> last week
        makeEntry({ date: "2026-06-08" }), // last Monday -> last week
        makeEntry({ date: "2026-06-07" }), // before last Monday -> neither
      ],
      4,
    );
    expect(volume.thisWeekCompleted).toBe(1);
    expect(volume.lastWeekCompleted).toBe(2);
  });

  it("ignores non-completed and dateless entries", () => {
    const volume = computeWeeklyVolume(
      [
        makeEntry({ status: PLANNED, date: "2026-06-16" }),
        makeEntry({ date: "" }),
        makeEntry({ date: "2026-06-16" }),
      ],
      4,
    );
    expect(volume.thisWeekCompleted).toBe(1);
    expect(volume.lastWeekCompleted).toBe(0);
  });
});

describe("computeExerciseGaps", () => {
  const ALL_STATIONS = [
    "skierg",
    "sled_push",
    "sled_pull",
    "burpee_broad_jump",
    "rowing",
    "farmers_carry",
    "sandbag_lunges",
    "wall_balls",
    "running",
  ];

  it("returns every station with a null gap when nothing was trained", () => {
    const gaps = computeExerciseGaps([]);
    expect(gaps.map((g) => g.station)).toEqual(ALL_STATIONS);
    expect(gaps.every((g) => g.daysSinceLastTrained === null)).toBe(true);
  });

  it("derives a gap from a structured exercise set by station name", () => {
    const gaps = gapsByStation([
      makeEntry({ date: "2026-06-10", exerciseSets: [makeSet({ exerciseName: "skierg" })] }),
    ]);
    expect(gaps.skierg).toBe(5);
    expect(gaps.rowing).toBeNull();
  });

  it("matches station names case-insensitively", () => {
    const gaps = gapsByStation([
      makeEntry({ date: "2026-06-13", exerciseSets: [makeSet({ exerciseName: "WALL_BALLS" })] }),
    ]);
    expect(gaps.wall_balls).toBe(2);
  });

  it("maps run-type exercise sets onto the running station", () => {
    const gaps = gapsByStation([
      makeEntry({ date: "2026-06-12", exerciseSets: [makeSet({ exerciseName: "interval_run" })] }),
    ]);
    expect(gaps.running).toBe(3);
  });

  it("derives gaps from free-text focus keywords", () => {
    const gaps = gapsByStation([makeEntry({ date: "2026-06-14", focus: "Hard rowing intervals" })]);
    expect(gaps.rowing).toBe(1);
  });

  it("keeps the most recent training date when a station appears multiple times", () => {
    const gaps = gapsByStation([
      makeEntry({ date: "2026-06-01", exerciseSets: [makeSet({ exerciseName: "skierg" })] }),
      makeEntry({ date: "2026-06-10", exerciseSets: [makeSet({ exerciseName: "skierg" })] }),
    ]);
    expect(gaps.skierg).toBe(5);
  });

  it("records a zero-day gap for something trained today", () => {
    const gaps = gapsByStation([
      makeEntry({ date: TODAY, exerciseSets: [makeSet({ exerciseName: "sled_push" })] }),
    ]);
    expect(gaps.sled_push).toBe(0);
  });

  it("ignores non-completed and dateless entries", () => {
    const gaps = gapsByStation([
      makeEntry({
        status: PLANNED,
        date: "2026-06-10",
        exerciseSets: [makeSet({ exerciseName: "skierg" })],
      }),
      makeEntry({ date: "", exerciseSets: [makeSet({ exerciseName: "rowing" })] }),
    ]);
    expect(gaps.skierg).toBeNull();
    expect(gaps.rowing).toBeNull();
  });
});

describe("computeProgressionFlags", () => {
  it("returns no flags for an empty timeline", () => {
    expect(computeProgressionFlags([])).toEqual([]);
  });

  it("flags an exercise trained only once as new", () => {
    const flags = computeProgressionFlags([weightEntry("2026-06-10", 100)]);
    expect(flags).toEqual([
      { exercise: BACK_SQUAT, flag: "new", detail: "Only trained once (2026-06-10)" },
    ]);
  });

  it("does not flag an exercise with two weight sessions (needs three)", () => {
    expect(
      computeProgressionFlags([weightEntry("2026-06-08", 100), weightEntry("2026-06-10", 105)]),
    ).toEqual([]);
  });

  it("flags a weight plateau across the last three sessions", () => {
    const flags = computeProgressionFlags([
      weightEntry("2026-06-01", 100),
      weightEntry("2026-06-05", 100),
      weightEntry("2026-06-10", 100),
    ]);
    expect(flags).toEqual([
      {
        exercise: BACK_SQUAT,
        flag: "plateau",
        detail: "Weight stuck at 100kg for last 3 sessions",
      },
    ]);
  });

  it("flags rising weight as progressing using date-sorted sessions", () => {
    // Provided out of order; the function sorts by date ascending.
    const flags = computeProgressionFlags([
      weightEntry("2026-06-10", 110),
      weightEntry("2026-06-01", 100),
      weightEntry("2026-06-05", 105),
    ]);
    expect(flags).toEqual([
      {
        exercise: BACK_SQUAT,
        flag: "progressing",
        detail: "Weight increased from 100kg to 110kg over last 3 sessions",
      },
    ]);
  });

  it("flags falling weight as regressing", () => {
    const flags = computeProgressionFlags([
      weightEntry("2026-06-01", 110),
      weightEntry("2026-06-05", 105),
      weightEntry("2026-06-10", 100),
    ]);
    expect(flags[0]).toMatchObject({
      flag: "regressing",
      detail: "Weight decreased from 110kg to 100kg over last 3 sessions",
    });
  });

  it("handles multiple sessions sharing the same date in the sort", () => {
    const flags = computeProgressionFlags([
      weightEntry("2026-06-05", 100),
      weightEntry("2026-06-05", 105),
      weightEntry("2026-06-10", 110),
    ]);
    expect(flags[0]).toMatchObject({
      flag: "progressing",
      detail: "Weight increased from 100kg to 110kg over last 3 sessions",
    });
  });

  it("only considers the most recent three weight sessions", () => {
    const flags = computeProgressionFlags([
      weightEntry("2026-06-01", 50),
      weightEntry("2026-06-05", 100),
      weightEntry("2026-06-08", 100),
      weightEntry("2026-06-10", 100),
    ]);
    expect(flags[0]).toMatchObject({ flag: "plateau" });
  });

  it("falls back to time progression when there is no weight data", () => {
    const flags = computeProgressionFlags([
      timeEntry("2026-06-01", 40),
      timeEntry("2026-06-05", 35),
      timeEntry("2026-06-10", 30),
    ]);
    expect(flags).toEqual([
      {
        exercise: "rowing",
        flag: "progressing",
        detail: "Time improved from 40min to 30min over last 3 sessions",
      },
    ]);
  });

  it("flags a time plateau within the 0.1min tolerance", () => {
    const flags = computeProgressionFlags([
      timeEntry("2026-06-01", 30),
      timeEntry("2026-06-05", 30),
      timeEntry("2026-06-10", 30),
    ]);
    expect(flags).toEqual([
      { exercise: "rowing", flag: "plateau", detail: "Time stuck at 30min for last 3 sessions" },
    ]);
  });

  it("flags worsening time as regressing", () => {
    const flags = computeProgressionFlags([
      timeEntry("2026-06-01", 30),
      timeEntry("2026-06-05", 35),
      timeEntry("2026-06-10", 40),
    ]);
    expect(flags[0]).toMatchObject({
      flag: "regressing",
      detail: "Time worsened from 30min to 40min over last 3 sessions",
    });
  });

  it("emits no flag when the latest time equals the oldest (non-monotonic)", () => {
    expect(
      computeProgressionFlags([
        timeEntry("2026-06-01", 30),
        timeEntry("2026-06-05", 35),
        timeEntry("2026-06-10", 30),
      ]),
    ).toEqual([]);
  });

  it("emits no flag when the latest weight equals the oldest (non-monotonic)", () => {
    expect(
      computeProgressionFlags([
        weightEntry("2026-06-01", 100),
        weightEntry("2026-06-05", 110),
        weightEntry("2026-06-10", 100),
      ]),
    ).toEqual([]);
  });

  it("prioritises a weight flag over a time flag for the same exercise", () => {
    const entry = (date: string) =>
      makeEntry({
        date,
        exerciseSets: [
          makeSet({ exerciseName: BACK_SQUAT, weight: 100, time: date === "2026-06-10" ? 30 : 40 }),
        ],
      });
    const flags = computeProgressionFlags([
      entry("2026-06-01"),
      entry("2026-06-05"),
      entry("2026-06-10"),
    ]);
    // Weights are flat (plateau) so the improving time is never evaluated.
    expect(flags).toEqual([
      {
        exercise: BACK_SQUAT,
        flag: "plateau",
        detail: "Weight stuck at 100kg for last 3 sessions",
      },
    ]);
  });

  it("aggregates the heaviest set within a single session", () => {
    const session = (date: string, weights: number[]) =>
      makeEntry({
        date,
        exerciseSets: weights.map((weight, i) =>
          makeSet({ exerciseName: BACK_SQUAT, weight, setNumber: i + 1 }),
        ),
      });
    const flags = computeProgressionFlags([
      session("2026-06-01", [80, 100]),
      session("2026-06-05", [90, 100]),
      session("2026-06-10", [100, 120]),
    ]);
    // Per-session peaks are 100, 100, 120 -> progressing 100 -> 120.
    expect(flags[0]).toMatchObject({
      flag: "progressing",
      detail: "Weight increased from 100kg to 120kg over last 3 sessions",
    });
  });

  it("aggregates the fastest set within a single session", () => {
    const session = (date: string, times: number[]) =>
      makeEntry({
        date,
        exerciseSets: times.map((time, i) =>
          makeSet({ exerciseName: "rowing", time, setNumber: i + 1 }),
        ),
      });
    const flags = computeProgressionFlags([
      session("2026-06-01", [50, 40]),
      session("2026-06-05", [45, 40]),
      session("2026-06-10", [40, 30]),
    ]);
    // Per-session best times are 40, 40, 30 -> progressing 40 -> 30.
    expect(flags[0]).toMatchObject({
      flag: "progressing",
      detail: "Time improved from 40min to 30min over last 3 sessions",
    });
  });
});

describe("computeCurrentWeek", () => {
  it("returns week 1 when there is no plan start date", () => {
    expect(computeCurrentWeek(null, 12)).toBe(1);
    expect(computeCurrentWeek(undefined, 12)).toBe(1);
    expect(computeCurrentWeek("", 12)).toBe(1);
  });

  it("returns week 1 on the start date and through the first six days", () => {
    expect(computeCurrentWeek(TODAY, 12)).toBe(1);
    expect(computeCurrentWeek("2026-06-09", 12)).toBe(1);
  });

  it("rolls into week 2 exactly seven days after the start", () => {
    expect(computeCurrentWeek("2026-06-08", 12)).toBe(2);
  });

  it("counts multiple elapsed weeks", () => {
    expect(computeCurrentWeek("2026-06-01", 12)).toBe(3);
  });

  it("clamps the result to totalWeeks for a long-past start date", () => {
    expect(computeCurrentWeek("2026-01-01", 12)).toBe(12);
  });
});
