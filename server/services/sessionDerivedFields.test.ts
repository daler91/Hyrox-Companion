import type { TimelineEntry, WorkoutLog } from "@shared/schema";
import { describe, expect, it } from "vitest";

import {
  deviceSportTypeOf,
  mafCeilingOf,
  sessionMafCompliance,
  timelineDayKind,
  withSessionDerivedFields,
  workoutDerivedFields,
} from "./sessionDerivedFields";

const MAF_ATHLETE = { trainingStyleId: "maf_method", mafHr: 140 };
const RUN = [{ exerciseName: "easy_run" }];

function entry(overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    id: "log-w1",
    date: "2026-11-10",
    type: "logged",
    status: "completed",
    focus: "Easy run",
    mainWorkout: "Easy run",
    accessory: null,
    notes: null,
    ...overrides,
  };
}

describe("mafCeilingOf", () => {
  it("is the stored ceiling only for an athlete on the MAF method", () => {
    expect(mafCeilingOf(MAF_ATHLETE)).toBe(140);
    expect(mafCeilingOf({ trainingStyleId: "balanced_default", mafHr: 140 })).toBeNull();
    expect(mafCeilingOf({ trainingStyleId: "maf_method", mafHr: null })).toBeNull();
    expect(mafCeilingOf(undefined)).toBeNull();
  });
});

describe("sessionMafCompliance", () => {
  it("scores a completed run's average against the ceiling", () => {
    expect(sessionMafCompliance({ status: "completed", avgHeartrate: 144, exerciseSets: RUN }, 140)).toEqual({
      compliancePct: 76,
      classification: "over_ceiling",
      nextAction:
        "Your average was 4 bpm over your MAF ceiling — slow down (walk the hills if you need to) so the effort trains the aerobic system.",
      avgOverBy: 4,
    });
    expect(sessionMafCompliance({ avgHeartrate: 132, maxHeartrate: 150, exerciseSets: RUN }, 140)).toMatchObject({
      compliancePct: 85,
      classification: "mostly_compliant",
      avgOverBy: -8,
    });
    expect(sessionMafCompliance({ avgHeartrate: 138, maxHeartrate: 142, exerciseSets: RUN }, 140)).toMatchObject({
      compliancePct: 100,
      classification: "compliant",
      avgOverBy: -2,
    });
  });

  it("scores nothing without a ceiling, an average, running or a finished session", () => {
    expect(sessionMafCompliance({ avgHeartrate: 144, exerciseSets: RUN }, null)).toBeNull();
    expect(sessionMafCompliance({ avgHeartrate: null, exerciseSets: RUN }, 140)).toBeNull();
    expect(sessionMafCompliance({ avgHeartrate: 0, exerciseSets: RUN }, 140)).toBeNull();
    expect(sessionMafCompliance({ avgHeartrate: 165, exerciseSets: [{ exerciseName: "wall_balls" }] }, 140)).toBeNull();
    expect(sessionMafCompliance({ status: "planned", avgHeartrate: 144, exerciseSets: RUN }, 140)).toBeNull();
  });
});

describe("timelineDayKind", () => {
  it("knows the race by its exact marker, in any case", () => {
    expect(timelineDayKind(entry({ type: "planned", focus: " race day " }))).toBe("race");
    expect(timelineDayKind(entry({ focus: "Race Day" }))).toBe("race");
    expect(timelineDayKind(entry({ type: "planned", focus: "Race Pace", mainWorkout: "5 x 1 km at race pace" }))).toBe("session");
  });

  it("calls a planned day worded as rest a rest day, and a recovery run a session", () => {
    expect(timelineDayKind(entry({ type: "planned", focus: "Active recovery", mainWorkout: "Mobility" }))).toBe("rest");
    expect(timelineDayKind(entry({ type: "planned", focus: "Easy", mainWorkout: "Complete rest or light walk." }))).toBe("rest");
    expect(timelineDayKind(entry({ type: "planned", focus: "Recovery run", mainWorkout: "30 min easy" }))).toBe("session");
    expect(timelineDayKind(entry({ type: "logged", focus: "Rest", mainWorkout: "Walk" }))).toBe("session");
  });
});

describe("withSessionDerivedFields", () => {
  it("adds the day kind to every entry, and the cadence unit and MAF score where they apply", () => {
    const ride = entry({ id: "log-w2", avgCadence: 88, deviceSportType: "Ride" });
    const run = entry({ avgCadence: 172, deviceSportType: "Run", avgHeartrate: 144, exerciseSets: RUN as TimelineEntry["exerciseSets"] });
    const rest = entry({ id: "plan-d1", type: "planned", status: "missed", focus: "Rest", mainWorkout: "Rest" });

    const [withRide, withRun, withRest] = withSessionDerivedFields([ride, run, rest], MAF_ATHLETE);

    expect(withRide).toEqual({ ...ride, dayKind: "session", avgCadenceUnit: "rpm" });
    expect(withRun).toMatchObject({ dayKind: "session", avgCadenceUnit: "spm", mafCompliance: { avgOverBy: 4 } });
    expect(withRest).toEqual({ ...rest, dayKind: "rest" });
  });

  it("scores no one who doesn't train the MAF method", () => {
    const run = entry({ avgHeartrate: 144, exerciseSets: RUN as TimelineEntry["exerciseSets"] });
    expect(withSessionDerivedFields([run], { trainingStyleId: "balanced_default", mafHr: 140 })[0]).not.toHaveProperty("mafCompliance");
    expect(withSessionDerivedFields([run], undefined)[0]).not.toHaveProperty("mafCompliance");
  });
});

describe("workoutDerivedFields", () => {
  function log(overrides: Partial<WorkoutLog> = {}): WorkoutLog {
    return { source: "manual", focus: "Morning run", deviceActivity: null, avgCadence: null, avgHeartrate: null, maxHeartrate: null, ...overrides } as WorkoutLog;
  }

  it("labels the cadence by the recording's sport, a standalone import's by its focus", () => {
    expect(workoutDerivedFields(log({ avgCadence: 90, deviceActivity: { raw: { sport_type: "VirtualRide" } } as never }), [], null)).toEqual({
      avgCadenceUnit: "rpm",
    });
    expect(deviceSportTypeOf(log({ source: "strava", focus: "Ride" }))).toBe("Ride");
    expect(workoutDerivedFields(log({ avgCadence: 170, source: "strava", focus: "Run" }), [], null)).toEqual({ avgCadenceUnit: "spm" });
    expect(workoutDerivedFields(log(), [], null)).toEqual({});
  });

  it("scores a run against the MAF ceiling", () => {
    expect(workoutDerivedFields(log({ avgHeartrate: 138 }), RUN, MAF_ATHLETE)).toEqual({
      mafCompliance: {
        compliancePct: 100,
        classification: "compliant",
        nextAction: "On target — keep building aerobic volume at this effort.",
        avgOverBy: -2,
      },
    });
  });
});
