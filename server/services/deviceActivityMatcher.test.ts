import { describe, expect, it } from "vitest";

import {
  classifyDeviceSport,
  classifyPrescription,
  decideMatch,
  DEFAULT_MATCH_THRESHOLDS,
  type DeviceActivityInput,
  type MatchCandidate,
  MIN_MATCHABLE_MOVING_SEC,
  nameOverlap,
  parsePrescribedDistanceMeters,
  planDeviceActivityMatches,
  scoreCandidate,
  timeOfDayProximity,
} from "./deviceActivityMatcher";

const DATE = "2026-09-08";

function activity(overrides: Partial<DeviceActivityInput> = {}): DeviceActivityInput {
  return {
    externalId: "1",
    name: "Morning Run",
    sportType: "Run",
    localDate: DATE,
    localStartMinutes: 6 * 60 + 30,
    movingTimeSec: 45 * 60,
    distanceMeters: 8100,
    ...overrides,
  };
}

function candidate(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    kind: "plan_day",
    id: "pd-1",
    focus: "Easy Run",
    mainWorkout: "8 km easy, conversational pace",
    accessory: null,
    durationMin: 45,
    distanceMeters: null,
    localStartMinutes: null,
    ...overrides,
  };
}

describe("classifyDeviceSport", () => {
  it("maps Strava sport types to coarse kinds", () => {
    expect(classifyDeviceSport("Run")).toBe("run");
    expect(classifyDeviceSport("TrailRun")).toBe("run");
    expect(classifyDeviceSport("Ride")).toBe("ride");
    expect(classifyDeviceSport("GravelRide")).toBe("ride");
    expect(classifyDeviceSport("Rowing")).toBe("row");
    expect(classifyDeviceSport("Swim")).toBe("swim");
    expect(classifyDeviceSport("Walk")).toBe("walk");
    expect(classifyDeviceSport("Hike")).toBe("walk");
    expect(classifyDeviceSport("WeightTraining")).toBe("strength");
    expect(classifyDeviceSport("Workout")).toBe("conditioning");
    expect(classifyDeviceSport("Crossfit")).toBe("conditioning");
    expect(classifyDeviceSport("HighIntensityIntervalTraining")).toBe("conditioning");
    expect(classifyDeviceSport("Golf")).toBe("other");
    expect(classifyDeviceSport(undefined)).toBe("other");
  });
});

describe("classifyPrescription", () => {
  it("reads the coach's focus label first", () => {
    expect(classifyPrescription("Long Run", "16 km progressive")).toBe("run");
    expect(classifyPrescription("Strength", "Back squat 5x5, RDL 3x8")).toBe("strength");
    expect(classifyPrescription("Hyrox Sim", "8 x 1 km run + all 8 stations")).toBe("conditioning");
    expect(classifyPrescription("Rest", "")).toBe("rest");
    expect(classifyPrescription("Rowing Intervals", "6 x 500 m")).toBe("row");
    expect(classifyPrescription("Bike", "60 min zone 2")).toBe("ride");
  });

  it("treats a sim prescribed with runs as conditioning, not a run", () => {
    expect(
      classifyPrescription("Session", "4 rounds: 1 km run, 50 wall balls, 100 m sled push"),
    ).toBe("conditioning");
  });

  it("does not read a between-sets rest instruction as a rest day", () => {
    expect(classifyPrescription("Lower Body", "Squat 4x6, rest 2 min between sets")).toBe(
      "strength",
    );
  });

  it("keeps active recovery out of rest", () => {
    expect(classifyPrescription("Active Recovery", "30 min easy walk")).toBe("walk");
  });

  it("falls back to unknown when nothing is recognisable", () => {
    expect(classifyPrescription("Session", "See coach notes")).toBe("unknown");
  });
});

describe("parsePrescribedDistanceMeters", () => {
  it("reads a single explicit distance", () => {
    expect(parsePrescribedDistanceMeters("8 km easy")).toBe(8000);
    expect(parsePrescribedDistanceMeters("Long run 10k")).toBe(10_000);
    expect(parsePrescribedDistanceMeters("5 miles steady")).toBeCloseTo(8046.72, 1);
    expect(parsePrescribedDistanceMeters("12.5km")).toBe(12_500);
  });

  it("refuses rep distances and multipliers", () => {
    expect(parsePrescribedDistanceMeters("6 x 800m")).toBeNull();
    expect(parsePrescribedDistanceMeters("8 x 1 km run + stations")).toBeNull();
    expect(parsePrescribedDistanceMeters("3 km warm-up then 5 km tempo")).toBeNull();
    expect(parsePrescribedDistanceMeters("Back squat 5x5")).toBeNull();
    expect(parsePrescribedDistanceMeters("")).toBeNull();
  });
});

describe("timeOfDayProximity", () => {
  it("is exact within an hour and fades to zero by six hours", () => {
    expect(timeOfDayProximity(390, 420)).toBe(1);
    expect(timeOfDayProximity(390, 450)).toBe(1);
    expect(timeOfDayProximity(390, 390 + 210)).toBeCloseTo(0.5, 5);
    expect(timeOfDayProximity(390, 390 + 360)).toBe(0);
  });
});

describe("nameOverlap", () => {
  it("scores shared meaningful tokens and ignores filler", () => {
    // "Morning" is filler and "8" / "km" are too short to count, so the
    // comparison is {run} against {easy, run}.
    expect(nameOverlap("Morning Run", "Easy Run 8 km")).toBeCloseTo(1 / 2, 5);
    expect(nameOverlap("Hyrox Sim", "Hyrox Sim full")).toBeCloseTo(2 / 3, 5);
    expect(nameOverlap("Morning", "Easy Run")).toBeNull();
  });
});

describe("scoreCandidate", () => {
  it("links a run to the day's run when distance and duration line up", () => {
    const { score, signals } = scoreCandidate(activity(), candidate());
    expect(signals.type).toBe(1);
    expect(signals.distance).toBeGreaterThan(0.95);
    expect(signals.duration).toBe(1);
    expect(score).toBeGreaterThanOrEqual(DEFAULT_MATCH_THRESHOLDS.autoLink);
  });

  it("judges on type alone when the plan day carries no duration or distance", () => {
    const sim = candidate({
      focus: "Hyrox Sim",
      mainWorkout: "Full sim, race pace",
      durationMin: null,
    });
    const { score, signals } = scoreCandidate(
      activity({ sportType: "Workout", name: "Sim", distanceMeters: 0, movingTimeSec: 62 * 60 }),
      sim,
    );
    expect(signals.duration).toBeUndefined();
    expect(signals.distance).toBeUndefined();
    expect(score).toBeGreaterThanOrEqual(DEFAULT_MATCH_THRESHOLDS.autoLink);
  });

  it("damps an incompatible sport so numbers cannot rescue it", () => {
    const strength = candidate({
      focus: "Strength",
      mainWorkout: "Squat 5x5, bench 5x5",
      durationMin: 60,
    });
    const ride = activity({
      sportType: "Ride",
      name: "Lunch Ride",
      movingTimeSec: 60 * 60,
      distanceMeters: 30_000,
      localStartMinutes: 12 * 60,
    });
    const { score } = scoreCandidate(ride, strength);
    expect(score).toBeLessThan(DEFAULT_MATCH_THRESHOLDS.suggest);
  });

  it("never scores a rest day", () => {
    const rest = candidate({ focus: "Rest", mainWorkout: "Full rest", durationMin: null });
    expect(
      scoreCandidate(
        activity({ sportType: "Walk", movingTimeSec: 40 * 60, distanceMeters: 3000 }),
        rest,
      ).score,
    ).toBe(0);
  });

  it("drops to the suggestion band when the duration is far off", () => {
    const { score } = scoreCandidate(
      activity({ movingTimeSec: 90 * 60, distanceMeters: 0, name: "Run" }),
      candidate({ mainWorkout: "Easy run, 45 min", durationMin: 45 }),
    );
    expect(score).toBeLessThan(DEFAULT_MATCH_THRESHOLDS.autoLink);
    expect(score).toBeGreaterThanOrEqual(DEFAULT_MATCH_THRESHOLDS.suggest);
  });

  it("uses a manually entered log distance when present", () => {
    const log = candidate({
      kind: "workout_log",
      id: "log-1",
      mainWorkout: "Tempo",
      distanceMeters: 8000,
      durationMin: 46,
    });
    expect(scoreCandidate(activity(), log).signals.distance).toBeGreaterThan(0.95);
  });
});

describe("decideMatch", () => {
  it("prefers the compatible candidate on a two-session day", () => {
    const run = candidate({ id: "run-day" });
    const strength = candidate({
      id: "strength-day",
      focus: "Strength",
      mainWorkout: "Deadlift 5x3",
      durationMin: 45,
    });
    const decision = decideMatch(activity(), [strength, run]);
    expect(decision.outcome).toBe("link");
    if (decision.outcome === "link") expect(decision.candidate.id).toBe("run-day");
  });

  it("ignores watch mis-taps shorter than the floor", () => {
    expect(
      decideMatch(activity({ movingTimeSec: MIN_MATCHABLE_MOVING_SEC - 1 }), [candidate()]).outcome,
    ).toBe("none");
  });

  it("returns none with no candidates", () => {
    expect(decideMatch(activity(), [])).toEqual({ outcome: "none", score: null });
  });
});

describe("planDeviceActivityMatches", () => {
  it("assigns one activity per row and lets the better fit win", () => {
    const tempo = candidate({
      id: "tempo",
      focus: "Tempo Run",
      mainWorkout: "45 min tempo",
      durationMin: 45,
    });
    const warmUp = activity({
      externalId: "warm",
      name: "Warm up",
      movingTimeSec: 12 * 60,
      distanceMeters: 2000,
      localStartMinutes: 17 * 60,
    });
    const main = activity({
      externalId: "main",
      name: "Tempo",
      movingTimeSec: 46 * 60,
      distanceMeters: 10_000,
      localStartMinutes: 17 * 60 + 15,
    });

    const planned = planDeviceActivityMatches([warmUp, main], new Map([[DATE, [tempo]]]));
    const byId = new Map(planned.map((p) => [p.activity.externalId, p.decision]));

    expect(byId.get("main")?.outcome).toBe("link");
    // The tempo row is taken; the warm-up is not offered it as a suggestion either.
    expect(byId.get("warm")?.outcome).toBe("none");
  });

  it("keeps activities on different days apart", () => {
    const monday = candidate({ id: "mon" });
    const tuesday = candidate({ id: "tue" });
    const planned = planDeviceActivityMatches(
      [
        activity({ externalId: "a", localDate: "2026-09-07" }),
        activity({ externalId: "b", localDate: "2026-09-08" }),
      ],
      new Map([
        ["2026-09-07", [monday]],
        ["2026-09-08", [tuesday]],
      ]),
    );
    expect(planned[0].decision).toMatchObject({ outcome: "link", candidate: { id: "mon" } });
    expect(planned[1].decision).toMatchObject({ outcome: "link", candidate: { id: "tue" } });
  });

  it("records a suggestion without claiming the row", () => {
    const easy = candidate({ id: "easy", mainWorkout: "Easy run 45 min", durationMin: 45 });
    const planned = planDeviceActivityMatches(
      [activity({ externalId: "long", movingTimeSec: 90 * 60, distanceMeters: 0, name: "Run" })],
      new Map([[DATE, [easy]]]),
    );
    expect(planned[0].decision).toMatchObject({ outcome: "suggest", candidate: { id: "easy" } });
  });
});
