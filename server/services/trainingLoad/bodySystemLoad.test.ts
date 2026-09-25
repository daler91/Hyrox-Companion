import { describeBodySystemDivergence } from "@shared/bodySystemLoad";
import { addDaysToISODate } from "@shared/dateUtils";
import type { BodySystem, BodySystemLoadOverview, BodySystemLoadSummary } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { makeWorkoutLog } from "../trainingLoadService.testHelpers";
import { type BodySystemSet, calculateBodySystemLoad } from "./bodySystemLoad";

// Six rolling blocks ending on TODAY, oldest first:
//   08-15..08-21, 08-22..08-28, 08-29..09-04, 09-05..09-11, 09-12..09-18, 09-19..09-25
const TODAY = "2026-09-25";

/** A date `offset` days into the block `weeksBack` blocks before the newest (0 = its last day). */
function day(weeksBack: number, offset = 0): string {
  return addDaysToISODate(TODAY, -(7 * weeksBack) - offset);
}

let nextId = 0;

interface Session {
  log: ReturnType<typeof makeWorkoutLog>;
  sets: BodySystemSet[];
}

function session(
  date: string,
  overrides: Partial<ReturnType<typeof makeWorkoutLog>>,
  sets: Array<Partial<BodySystemSet>> = [],
): Session {
  const id = `log-${++nextId}`;
  return {
    log: makeWorkoutLog({ id, date, ...overrides }),
    sets: sets.map((set) => ({
      workoutLogId: id,
      exerciseName: "custom",
      customLabel: null,
      category: "strength",
      ...set,
    })),
  };
}

/** 45 min at RPE 4: 180 AU — aerobic 180, impact 180, legs 90. */
function easyRun(date: string): Session {
  return session(date, { focus: "Easy run", duration: 45, rpe: 4 }, [
    { exerciseName: "easy_run", category: "running", time: 45 },
  ]);
}

/** 45 min at RPE 6: 270 AU — legs 270, aerobic 40.5 (the lifting share). */
function legDay(date: string): Session {
  const squat = { exerciseName: "back_squat", category: "strength", reps: 5 };
  return session(date, { focus: "Legs", duration: 45, rpe: 6 }, [squat, squat, squat, squat]);
}

/** 30 min at RPE 6 on the rower: 180 AU — pull 90, legs 108, aerobic 180. */
function rowSession(date: string): Session {
  return session(date, { focus: "Row", duration: 30, rpe: 6 }, [
    { exerciseName: "rowing", category: "functional", time: 30 },
  ]);
}

function run(
  sessions: readonly Session[],
  options: { athlete?: { restingHr: number; maxHr: number } } = {},
) {
  return calculateBodySystemLoad(
    sessions.map((s) => s.log),
    sessions.flatMap((s) => s.sets),
    { currentDate: TODAY, ...options },
  );
}

function system(overview: BodySystemLoadOverview, name: BodySystem): BodySystemLoadSummary {
  const found = overview.systems.find((s) => s.system === name);
  if (!found) throw new Error(`missing ${name}`);
  return found;
}

/**
 * The same three easy runs every week for six weeks, one leg session a week
 * before this one, and `legDaysThisWeek` (up to three) this week. An older run,
 * before the window, puts all six blocks inside the athlete's history.
 */
function runsAndLegDays(legDaysThisWeek: number): Session[] {
  const sessions: Session[] = [easyRun(day(7))];
  for (let weeksBack = 0; weeksBack <= 5; weeksBack++) {
    sessions.push(
      easyRun(day(weeksBack, 0)),
      easyRun(day(weeksBack, 2)),
      easyRun(day(weeksBack, 4)),
    );
    if (weeksBack > 0) sessions.push(legDay(day(weeksBack, 5)));
  }
  for (const offset of [1, 3, 5].slice(0, legDaysThisWeek)) sessions.push(legDay(day(0, offset)));
  return sessions;
}

/** Three leg sessions this week against one a week before it. */
function legHeavyWeek(): Session[] {
  return runsAndLegDays(3);
}

describe("calculateBodySystemLoad", () => {
  it("catches leg load at a six-week high while aerobic load stays normal", () => {
    const overview = run(legHeavyWeek());

    const legs = system(overview, "leg_muscle");
    expect(legs).toMatchObject({
      current: 1080, // 3 × 90 (runs) + 3 × 270 (leg days)
      baseline: 540,
      ratio: 2,
      status: "very_high",
      sixWeekHigh: true,
      previousPeak: 540,
      weekly: [540, 540, 540, 540, 540, 1080],
    });

    // The extra lifting nudges aerobic load up 14%: still normal, and not
    // enough to call a six-week high on its own.
    const aerobic = system(overview, "aerobic");
    expect(aerobic).toMatchObject({
      current: 662,
      baseline: 581,
      ratio: 1.14,
      status: "normal",
      sixWeekHigh: false,
    });

    expect(system(overview, "running_impact")).toMatchObject({
      current: 540,
      ratio: 1,
      status: "normal",
    });
    expect(system(overview, "upper_pull")).toMatchObject({
      current: 0,
      baseline: 0,
      status: "minimal",
    });

    expect(describeBodySystemDivergence(overview)).toBe(
      "Leg muscle load is at a six-week high (100% above your usual week), while aerobic and running impact loads are normal.",
    );
  });

  it("reports the six rolling blocks it compared, oldest first", () => {
    const overview = run(legHeavyWeek());
    expect(overview.asOf).toBe(TODAY);
    expect(overview.weeks[0]).toEqual({ start: "2026-08-15", end: "2026-08-21" });
    expect(overview.weeks.at(-1)).toEqual({ start: "2026-09-19", end: "2026-09-25" });
    expect(overview.weeks).toHaveLength(6);
    // The run before the window sets the history, not the totals.
    expect(overview.sessionCount).toBe(3 * 6 + 5 + 3);
  });

  it("splits a mixed session by each exercise's share of its time", () => {
    // 40 min at RPE 5 = 200 AU. A 20-min run and four squat sets (3 min each):
    // the run is 20/32 of the time.
    const overview = run([
      session(day(0), { duration: 40, rpe: 5 }, [
        { exerciseName: "easy_run", category: "running", time: 20 },
        ...Array.from({ length: 4 }, () => ({
          exerciseName: "back_squat",
          category: "strength",
          reps: 5,
        })),
      ]),
    ]);
    expect(system(overview, "aerobic").current).toBe(136); // 200 × (20/32 + 12/32 × 0.15)
    expect(system(overview, "running_impact").current).toBe(125); // 200 × 20/32
    expect(system(overview, "leg_muscle").current).toBe(138); // 200 × (20/32 × 0.5 + 12/32)
    expect(system(overview, "upper_pull").current).toBe(0);
  });

  it("is still building a baseline for a new athlete, and shows only the weeks they have", () => {
    const overview = run([easyRun(day(1, 2)), easyRun(day(0, 1))]);
    for (const summary of overview.systems) {
      expect(summary.status, summary.system).toBe("insufficient_data");
      expect(summary.baseline).toBeNull();
      expect(summary.previousPeak).toBeNull();
      expect(summary.sixWeekHigh).toBe(false);
    }
    // First log on 09-16: the 09-12..09-18 block is a real, partial week.
    expect(system(overview, "aerobic").weekly).toEqual([null, null, null, null, 180, 180]);
  });

  it("calls a real week of load against almost none in the four before it new", () => {
    const sessions = legHeavyWeek();
    sessions.push(rowSession(day(0, 2)), rowSession(day(0, 6)));
    const pull = system(run(sessions), "upper_pull");
    expect(pull).toMatchObject({
      current: 180,
      baseline: 0,
      ratio: null,
      status: "new",
      sixWeekHigh: false,
    });
  });

  it("reads a week off a system as low", () => {
    expect(system(run(runsAndLegDays(0)), "leg_muscle")).toMatchObject({
      current: 270,
      baseline: 540,
      ratio: 0.5,
      status: "low",
    });
  });

  it("does not call a six-week high on a partial six weeks of history", () => {
    // The same leg-heavy week, but history starting inside the oldest block.
    const sessions = legHeavyWeek().slice(1);
    const legs = system(run(sessions), "leg_muscle");
    expect(legs.status).toBe("very_high");
    expect(legs.previousPeak).toBeNull();
    expect(legs.sixWeekHigh).toBe(false);
  });

  describe("session effort", () => {
    it("uses the athlete's heart-rate equivalent when they gave no RPE, and counts it as estimated", () => {
      // (150 - 60) / 130 = 0.69 of reserve → RPE 7; 30 min → 210 AU.
      const overview = run(
        [
          session(day(0), { duration: 30, rpe: null, avgHeartrate: 150 }, [
            { exerciseName: "easy_run", category: "running", time: 30 },
          ]),
        ],
        { athlete: { restingHr: 60, maxHr: 190 } },
      );
      expect(system(overview, "aerobic").current).toBe(210);
      expect(overview.estimatedSessions).toBe(1);
    });

    it("falls back to the effort of what was logged without a rating or heart rate", () => {
      // An easy run's default effort is RPE 3: 30 min → 90 AU.
      const overview = run([
        session(day(0), { duration: 30, rpe: null }, [
          { exerciseName: "easy_run", category: "running", time: 30 },
        ]),
      ]);
      expect(system(overview, "aerobic").current).toBe(90);
      expect(overview.estimatedSessions).toBe(1);
    });

    it("does not read effort from heart rate on a lifting session", () => {
      const overview = run(
        [
          session(
            day(0),
            {
              duration: 60,
              rpe: null,
              avgHeartrate: 150,
              source: "strava",
              focus: "WeightTraining",
            },
            Array.from({ length: 4 }, () => ({
              exerciseName: "back_squat",
              category: "strength",
              reps: 5,
            })),
          ),
        ],
        { athlete: { restingHr: 60, maxHr: 190 } },
      );
      // Strength's default effort (RPE 6), not the heart rate's 7: 360 AU on the legs.
      expect(system(overview, "leg_muscle").current).toBe(360);
    });
  });

  describe("session duration", () => {
    it("estimates a missing duration from the logged sets, in each row's own units", () => {
      // 16,404.2 ft stamped on the row is 5 km: 27.5 min at the easy-run pace → 28 min × RPE 4.
      const overview = run([
        session(day(0), { duration: null, rpe: 4 }, [
          { exerciseName: "easy_run", category: "running", distance: 16404.2, distanceUnit: "ft" },
        ]),
      ]);
      expect(system(overview, "aerobic").current).toBe(112);
      expect(overview.estimatedSessions).toBe(1);
    });

    it("scores nothing for a session with neither a duration nor any sets", () => {
      const overview = run([session(day(0), { focus: "Morning run", duration: null, rpe: 5 })]);
      expect(overview).toMatchObject({ sessionCount: 1, unscoredSessions: 1 });
      expect(system(overview, "aerobic").current).toBe(0);
    });
  });

  describe("sessions with no sets", () => {
    it("reads the sport from the title", () => {
      const overview = run([
        session(day(0), { focus: "Morning Run", mainWorkout: "", duration: 30, rpe: 5 }),
      ]);
      expect(overview.systems.map((s) => [s.system, s.current])).toEqual([
        ["aerobic", 150],
        ["running_impact", 150],
        ["leg_muscle", 75],
        ["upper_pull", 0],
      ]);
    });

    it("leaves a session nothing is known about unattributed rather than guessing", () => {
      const overview = run([
        session(day(0), { focus: "WeightTraining", mainWorkout: "", duration: 60, rpe: 7 }),
      ]);
      expect(overview.unattributedSessions).toBe(1);
      for (const summary of overview.systems) expect(summary.current, summary.system).toBe(0);
    });
  });

  it("ignores sessions dated after today", () => {
    const overview = run([easyRun(addDaysToISODate(TODAY, 1))]);
    expect(overview.sessionCount).toBe(0);
    expect(system(overview, "aerobic").weekly).toEqual([null, null, null, null, null, null]);
  });
});
