import { isPlanEnded, planWeekForDisplay } from "@shared/planPhase";
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

// Sized, non-distance work: a set of wall balls carries no distance, and its
// rep count says how big the effort was, so the clock is a RESULT. Runs and
// ergs are distance-carrying and go through the pace path instead — see the
// "duration is not a result" block below.
const WALL_BALLS = "wall_balls";
const FIXED_REPS = 50;

function timeEntry(date: string, time: number, reps: number | null = FIXED_REPS): TimelineEntry {
  return makeEntry({ date, exerciseSets: [makeSet({ exerciseName: WALL_BALLS, time, reps })] });
}

// A distance-carrying effort: metres + minutes, i.e. a real pace.
function runEntry(date: string, metres: number, time: number): TimelineEntry {
  return makeEntry({
    date,
    exerciseSets: [
      makeSet({ exerciseName: "easy_run", distance: metres, distanceUnit: "m", time }),
    ],
  });
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

  it("flags fatigue on a rise into the hard zone even below the absolute 8", () => {
    // last3 = [7,7,7] -> 7.0; prior3 = [5,5] -> 5.0; diff = +2 -> rising.
    const result = computeRpeTrend(recentsWithRpe([7, 7, 7, 5, 5]));
    expect(result.rpeTrend).toBe("rising");
    expect(result.fatigueFlag).toBe(true);
    expect(result.undertrainingFlag).toBe(false);
  });

  it("does not flag fatigue on a rise that stays in the moderate zone", () => {
    // last3 = [6,6,6] -> 6.0 (< 7 trend bound); prior3 = [3,3] -> 3.0; rising.
    const result = computeRpeTrend(recentsWithRpe([6, 6, 6, 3, 3]));
    expect(result.rpeTrend).toBe("rising");
    expect(result.fatigueFlag).toBe(false);
  });

  it("flags undertraining on a fall into the easy zone even above the absolute 4", () => {
    // last3 = [5,5,5] -> 5.0; prior3 = [8,8] -> 8.0; diff = -3 -> falling.
    const result = computeRpeTrend(recentsWithRpe([5, 5, 5, 8, 8]));
    expect(result.rpeTrend).toBe("falling");
    expect(result.undertrainingFlag).toBe(true);
    expect(result.fatigueFlag).toBe(false);
  });

  it("still flags fatigue for a sustained hard block with no upward trend", () => {
    // Stable, intentional RPE 8 keeps the absolute backstop active.
    const result = computeRpeTrend(recentsWithRpe([8, 8, 8, 8, 8, 8]));
    expect(result.rpeTrend).toBe("stable");
    expect(result.fatigueFlag).toBe(true);
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
      // Progress is measured at the week's MIDPOINT now, not its end (audit
      // H15), so week 1 of 12 is 4% through the block rather than 8%.
      progressPct: 4,
      remainingPhases: ["build", "peak", "taper", "race_week"],
    });
  });

  // The band thresholds are unchanged by the move to a midpoint measure. On a
  // 100-week block week 25 reads 24.5%, which Math.round takes UP to 25 — so
  // the same weeks sit on the same boundaries as before.
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
    // The final week's midpoint is 96% through the block; the label is
    // structural, not a percentage.
    expect(phase.progressPct).toBe(96);
    expect(phase.remainingPhases).toEqual([]);
  });

  it("makes the week before the race a taper, whatever the block length", () => {
    // Taper used to depend on the percentage alone, which under the midpoint
    // measure only 10+ week blocks could reach — an 8-week plan went peak →
    // race week with no taper at all.
    for (const totalWeeks of [4, 8, 12, 16]) {
      expect(computePlanPhase(totalWeeks, totalWeeks - 1)?.phaseLabel).toBe("taper");
      expect(computePlanPhase(totalWeeks, totalWeeks)?.phaseLabel).toBe("race_week");
    }
    // A 3-week block is too short to spend a third of itself tapering.
    expect(computePlanPhase(3, 2)?.phaseLabel).toBe("build");
  });

  it("opens in EARLY for a short block rather than jumping straight to build", () => {
    // A 4-week plan used to read 25% in week 1 and open in build; a 3-week plan
    // used to PEAK in week 2 (audit H15).
    expect(computePlanPhase(4, 1)?.phaseLabel).toBe("early");
    expect(computePlanPhase(3, 1)?.phaseLabel).toBe("early");
    expect(computePlanPhase(3, 2)?.phaseLabel).not.toBe("peak");
  });

  it("returns no phase at all once the block has ended", () => {
    // INVERTED (audit H15). This asserted that a week beyond the block still
    // reported race_week "overriding the percentage bands". Combined with
    // computeCurrentWeek's clamp, that meant a plan which ended months ago read
    // as race week forever and locked the coach into "reduce work only".
    expect(computePlanPhase(4, 5)).toBeUndefined();
    expect(computePlanPhase(12, 40)).toBeUndefined();
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

  // TODAY is Monday 2026-06-15, so "this week so far" is one day and the
  // comparable slice of last week is Monday 2026-06-08 alone (audit H11).
  it("flags a decreasing trend against the same point in last week", () => {
    const volume = computeWeeklyVolume(
      [makeEntry({ date: "2026-06-08" })], // last Monday: 1. This Monday: 0.
      3,
    );
    expect(volume.trend).toBe("decreasing");
  });

  it("flags a stable trend when both weeks are level at this point (including zero)", () => {
    expect(computeWeeklyVolume([], 5).trend).toBe("stable");
    const volume = computeWeeklyVolume(
      [makeEntry({ date: "2026-06-15" }), makeEntry({ date: "2026-06-08" })],
      5,
    );
    expect(volume.trend).toBe("stable");
  });

  it("does not read 'decreasing' on Monday just because last week was complete", () => {
    // INVERTED (audit H11). This case used to assert "decreasing": one session
    // logged so far this week against last week's completed total of two. The
    // partial week could never win, so the coach told every athlete their
    // volume was falling every Monday. Measured at the same point in each week,
    // one session by Monday beats last week's zero-by-Monday.
    const volume = computeWeeklyVolume(
      [
        makeEntry({ date: "2026-06-15" }), // today
        makeEntry({ date: "2026-06-09" }), // last Tuesday
        makeEntry({ date: "2026-06-10" }), // last Wednesday
      ],
      3,
    );
    expect(volume.trend).toBe("increasing");
    // The quoted totals are unchanged: last week really did have two.
    expect(volume.thisWeekCompleted).toBe(1);
    expect(volume.lastWeekCompleted).toBe(2);
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

  it("drops stations the athlete's standing constraints rule out", () => {
    // The gap computation has no equipment model; without this it renders
    // "sled_push (NEVER TRAINED — CRITICAL)" into the same prompt whose
    // constraints say "no sled at my gym" — every week, forever.
    const gaps = computeExerciseGaps([], "No sled at my gym. Recovering from wrist injury, no burpees.");
    const stations = gaps.map((g) => g.station);

    expect(stations).not.toContain("sled_push");
    expect(stations).not.toContain("sled_pull");
    expect(stations).not.toContain("burpee_broad_jump");
    // Everything the constraints don't mention still reports its gap.
    expect(stations).toContain("skierg");
    expect(stations).toContain("wall_balls");
  });

  it("suppresses nothing for empty or absent constraints", () => {
    expect(computeExerciseGaps([], "")).toHaveLength(ALL_STATIONS.length);
    expect(computeExerciseGaps([], null)).toHaveLength(ALL_STATIONS.length);
    expect(computeExerciseGaps([])).toHaveLength(ALL_STATIONS.length);
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

  it.each(["run_1k", "recovery_run", "hill_repeats", "fartlek_run", "treadmill_run"])(
    "counts %s as running",
    (exerciseName) => {
      // The hard-coded running set this replaced knew easy/tempo/interval/long
      // only, so an athlete doing 1 km repeats was told they hadn't run.
      const gaps = gapsByStation([
        makeEntry({ date: "2026-06-13", exerciseSets: [makeSet({ exerciseName })] }),
      ]);
      expect(gaps.running).toBe(2);
    },
  );

  it("counts the erg interval variants toward their station", () => {
    const gaps = gapsByStation([
      makeEntry({ date: "2026-06-12", exerciseSets: [makeSet({ exerciseName: "rowing_intervals" })] }),
      makeEntry({ date: "2026-06-11", exerciseSets: [makeSet({ exerciseName: "ski_erg_intervals" })] }),
    ]);
    expect(gaps.rowing).toBe(3);
    expect(gaps.skierg).toBe(4);
  });
});

// computeProgressionFlags now requires the athlete's weight unit (audit M8).
// Most cases below are unit-agnostic, so they go through a kg-fixed helper; the
// lbs behaviour is asserted explicitly at the end of this block.
const flagsInKg = (timeline: Parameters<typeof computeProgressionFlags>[0]) =>
  computeProgressionFlags(timeline, "kg", "km");

describe("computeProgressionFlags — weight unit labelling (audit M8)", () => {
  const threeRisingSessions = [
    weightEntry("2026-06-01", 100),
    weightEntry("2026-06-05", 105),
    weightEntry("2026-06-10", 110),
  ];

  it("labels a lbs athlete's loads in lbs, not kg", () => {
    const [flag] = computeProgressionFlags(threeRisingSessions, "lbs", "miles");
    expect(flag.detail).toBe("Weight increased from 100lbs to 110lbs over last 3 sessions");
    expect(flag.detail).not.toContain("kg");
  });

  it("labels a kg athlete's identical numbers in kg", () => {
    const [flag] = computeProgressionFlags(threeRisingSessions, "kg", "km");
    expect(flag.detail).toBe("Weight increased from 100kg to 110kg over last 3 sessions");
  });

  it("labels a plateau in the athlete's own unit", () => {
    const [flag] = computeProgressionFlags(
      [
        weightEntry("2026-06-01", 225),
        weightEntry("2026-06-05", 225),
        weightEntry("2026-06-10", 225),
      ],
      "lbs",
      "miles",
    );
    expect(flag.detail).toBe("Weight stuck at 225lbs for last 3 sessions");
  });
});

describe("computeProgressionFlags", () => {
  it("returns no flags for an empty timeline", () => {
    expect(flagsInKg([])).toEqual([]);
  });

  it("flags an exercise trained only once as new", () => {
    const flags = flagsInKg([weightEntry("2026-06-10", 100)]);
    expect(flags).toEqual([
      { exercise: BACK_SQUAT, flag: "new", detail: "Only trained once (2026-06-10)" },
    ]);
  });

  it("does not flag an exercise with two weight sessions (needs three)", () => {
    expect(
      flagsInKg([weightEntry("2026-06-08", 100), weightEntry("2026-06-10", 105)]),
    ).toEqual([]);
  });

  it("flags a weight plateau across the last three sessions", () => {
    const flags = flagsInKg([
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
    const flags = flagsInKg([
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
    const flags = flagsInKg([
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
    const flags = flagsInKg([
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
    const flags = flagsInKg([
      weightEntry("2026-06-01", 50),
      weightEntry("2026-06-05", 100),
      weightEntry("2026-06-08", 100),
      weightEntry("2026-06-10", 100),
    ]);
    expect(flags[0]).toMatchObject({ flag: "plateau" });
  });

  it("falls back to time progression when there is no weight data", () => {
    const flags = flagsInKg([
      timeEntry("2026-06-01", 40),
      timeEntry("2026-06-05", 35),
      timeEntry("2026-06-10", 30),
    ]);
    expect(flags).toEqual([
      {
        exercise: WALL_BALLS,
        flag: "progressing",
        detail: "Time improved from 40min to 30min over last 3 sessions",
      },
    ]);
  });

  it("flags a time plateau within the 0.1min tolerance", () => {
    const flags = flagsInKg([
      timeEntry("2026-06-01", 30),
      timeEntry("2026-06-05", 30),
      timeEntry("2026-06-10", 30),
    ]);
    expect(flags).toEqual([
      { exercise: WALL_BALLS, flag: "plateau", detail: "Time stuck at 30min for last 3 sessions" },
    ]);
  });

  it("flags worsening time as regressing", () => {
    const flags = flagsInKg([
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
      flagsInKg([
        timeEntry("2026-06-01", 30),
        timeEntry("2026-06-05", 35),
        timeEntry("2026-06-10", 30),
      ]),
    ).toEqual([]);
  });

  it("emits no flag when the latest weight equals the oldest (non-monotonic)", () => {
    expect(
      flagsInKg([
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
    const flags = flagsInKg([
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
    const flags = flagsInKg([
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
          makeSet({ exerciseName: WALL_BALLS, time, reps: FIXED_REPS, setNumber: i + 1 }),
        ),
      });
    const flags = flagsInKg([
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

describe("computeProgressionFlags — duration is not a result", () => {
  // The bug this block exists for: the coach told an athlete their treadmill
  // run had "worsened from 16 min to 53 min" and their easy runs were
  // "improving (33 min to 13 min)". Those are three runs of three different
  // LENGTHS, not three attempts at one effort. Reading the clock alone on
  // distance-carrying work turns every long run into a regression.
  it("does not read a longer run as a regression", () => {
    const flags = flagsInKg([
      runEntry("2026-06-01", 3000, 16),
      runEntry("2026-06-05", 6000, 32),
      runEntry("2026-06-10", 10000, 53),
    ]);
    // Same 5:18/km throughout — three different distances, one steady pace.
    expect(flags).toEqual([
      {
        exercise: "easy_run",
        flag: "plateau",
        detail: "Pace stuck at 5:20/km (3 km) for last 3 sessions",
      },
    ]);
  });

  it("does not read a shorter run as an improvement", () => {
    const flags = flagsInKg([
      runEntry("2026-06-01", 6000, 33),
      runEntry("2026-06-05", 4000, 22),
      runEntry("2026-06-10", 2400, 13.2),
    ]);
    // A steady 5:30/km at three lengths. The 33 min → 13 min collapse the
    // coach called an improvement is just a shorter run.
    expect(flags.map(f => f.flag)).toEqual(["plateau"]);
  });

  it("flags a genuinely faster pace as progressing, quoting the distances", () => {
    const flags = flagsInKg([
      runEntry("2026-06-01", 5000, 30), //  6:00/km
      runEntry("2026-06-05", 5000, 29),
      runEntry("2026-06-10", 8000, 44), //  5:30/km over a longer run
    ]);
    expect(flags).toEqual([
      {
        exercise: "easy_run",
        flag: "progressing",
        detail: "Pace improved from 6:00/km (5 km) to 5:30/km (8 km) over last 3 sessions",
      },
    ]);
  });

  it("flags a genuinely slower pace as regressing", () => {
    const flags = flagsInKg([
      runEntry("2026-06-01", 5000, 25), //  5:00/km
      runEntry("2026-06-05", 5000, 27),
      runEntry("2026-06-10", 5000, 30), //  6:00/km
    ]);
    expect(flags[0]).toMatchObject({
      flag: "regressing",
      detail: "Pace worsened from 5:00/km (5 km) to 6:00/km (5 km) over last 3 sessions",
    });
  });

  it("ignores pace noise under 3s per km", () => {
    const flags = flagsInKg([
      runEntry("2026-06-01", 5000, 25),
      runEntry("2026-06-05", 5000, 25.1),
      runEntry("2026-06-10", 5000, 25.15),
    ]);
    expect(flags[0]).toMatchObject({ flag: "plateau" });
  });

  it("says nothing at all about a distance exercise logged without its distance", () => {
    // Rowing carries a distance in its definition; 40 → 30 min of rowing with
    // no metres logged is not a result, so there is no honest flag to emit.
    const rowFor = (date: string, time: number) =>
      makeEntry({ date, exerciseSets: [makeSet({ exerciseName: "rowing", time })] });
    expect(
      flagsInKg([rowFor("2026-06-01", 40), rowFor("2026-06-05", 35), rowFor("2026-06-10", 30)]),
    ).toEqual([]);
  });

  it("compares raw time only when the rep count is identical", () => {
    const sameReps = flagsInKg([
      timeEntry("2026-06-01", 5, 50),
      timeEntry("2026-06-05", 4.5, 50),
      timeEntry("2026-06-10", 4, 50),
    ]);
    expect(sameReps[0]).toMatchObject({ flag: "progressing" });

    // 30 reps in 3 min is not a personal best over 50 reps in 4 min.
    const differentReps = flagsInKg([
      timeEntry("2026-06-01", 5, 50),
      timeEntry("2026-06-05", 4.5, 40),
      timeEntry("2026-06-10", 4, 30),
    ]);
    expect(differentReps).toEqual([]);
  });

  it("says nothing about an unsized clock, which may be a hold", () => {
    // A plank is time-under-tension: 60s beats 30s, so "Time improved from
    // 60s to 30s" has the sign backwards. With no rep count to size the
    // effort there is no way to tell a hold from a for-time set.
    const hold = (date: string, time: number) =>
      makeEntry({ date, exerciseSets: [makeSet({ exerciseName: "plank", time, reps: null })] });
    expect(
      flagsInKg([hold("2026-06-01", 0.5), hold("2026-06-05", 0.75), hold("2026-06-10", 1)]),
    ).toEqual([]);
  });

  it("prefers pace over raw duration when both are recorded", () => {
    const mixed = (date: string, metres: number, time: number) =>
      makeEntry({
        date,
        exerciseSets: [
          makeSet({ exerciseName: "rowing", distance: metres, distanceUnit: "m", time, setNumber: 1 }),
          makeSet({ exerciseName: "rowing", time: 60, setNumber: 2 }),
        ],
      });
    const flags = flagsInKg([
      mixed("2026-06-01", 2000, 8),
      mixed("2026-06-05", 2000, 7.5),
      mixed("2026-06-10", 2000, 7),
    ]);
    expect(flags[0].detail).toContain("Pace improved");
  });

  it("reads a miles athlete's stored feet as feet, and quotes pace per mile", () => {
    // distanceUnit "ft" is the stored stamp for a miles athlete (5280 ft = 1 mi).
    const run = (date: string, feet: number, time: number) =>
      makeEntry({
        date,
        exerciseSets: [
          makeSet({ exerciseName: "easy_run", distance: feet, distanceUnit: "ft", time }),
        ],
      });
    const [flag] = computeProgressionFlags(
      [run("2026-06-01", 15840, 27), run("2026-06-05", 15840, 26), run("2026-06-10", 15840, 24)],
      "lbs",
      "miles",
    );
    // 15840 ft = 3 miles: 9:00/mi then 8:00/mi.
    expect(flag.detail).toBe(
      "Pace improved from 9:00/mi (3 miles) to 8:00/mi (3 miles) over last 3 sessions",
    );
  });

  it("only compares metrics present in all three of the most recent sessions", () => {
    // The weight was logged in January and the two Junes; "over last 3
    // sessions" used to be asserted over exactly that, three non-adjacent
    // sessions spanning five months.
    const flags = flagsInKg([
      weightEntry("2026-01-05", 60),
      makeEntry({
        date: "2026-06-01",
        exerciseSets: [makeSet({ exerciseName: BACK_SQUAT, reps: 5 })],
      }),
      weightEntry("2026-06-05", 100),
      weightEntry("2026-06-10", 100),
    ]);
    expect(flags).toEqual([]);
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

  it("keeps counting past the end of the block instead of clamping", () => {
    // INVERTED (audit H15). This asserted a clamp to totalWeeks, which is what
    // made an ended plan indistinguishable from its final week. The true week
    // is returned so computePlanPhase can tell the block is over; callers that
    // display "week N of M" clamp with planWeekForDisplay.
    const week = computeCurrentWeek("2026-01-01", 12);
    expect(week).toBeGreaterThan(12);
    expect(planWeekForDisplay(week, 12)).toBe(12);
    expect(isPlanEnded(week, 12)).toBe(true);
    expect(isPlanEnded(6, 12)).toBe(false);
  });
});
