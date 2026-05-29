import type { TrainingLoadOverview, WorkoutLog } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { buildLoadGovernorSuggestions } from "./trainingLoadGovernor";
import {
  calculateCardioStressScore,
  calculateStrengthStressScore,
  calculateTrainingLoad,
  DEFAULT_EXERCISE_LOAD_TAGS,
  resolveAcwrZone,
  type TrainingLoadSet,
} from "./trainingLoadService";

function log(overrides: Partial<WorkoutLog>): WorkoutLog {
  return {
    id: "log-1",
    userId: "user-1",
    date: "2026-05-22",
    focus: "Run",
    mainWorkout: "Easy run",
    accessory: null,
    notes: null,
    prescribedMainWorkout: null,
    prescribedAccessory: null,
    prescribedNotes: null,
    plannedSetCount: null,
    actualSetCount: null,
    matchedSetCount: null,
    addedSetCount: null,
    removedSetCount: null,
    compliancePct: null,
    duration: null,
    rpe: null,
    planDayId: null,
    planId: null,
    source: "manual",
    stravaActivityId: null,
    garminActivityId: null,
    calories: null,
    distanceMeters: null,
    elevationGain: null,
    avgHeartrate: null,
    maxHeartrate: null,
    avgSpeed: null,
    maxSpeed: null,
    avgCadence: null,
    avgWatts: null,
    sufferScore: null,
    ...overrides,
  };
}

function set(overrides: Partial<TrainingLoadSet>): TrainingLoadSet {
  return {
    workoutLogId: "log-1",
    exerciseName: "back_squat",
    customLabel: null,
    category: "strength",
    setNumber: 1,
    reps: null,
    weight: null,
    distance: null,
    time: null,
    ...overrides,
  };
}

function daysBefore(date: string, offset: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - offset);
  return value.toISOString().split("T")[0];
}

describe("trainingLoadService", () => {
  it("applies nonlinear RPE scaling and exercise modifiers to strength stress", () => {
    const deadliftTag = DEFAULT_EXERCISE_LOAD_TAGS.find((tag) => tag.exerciseName === "deadlift");
    expect(deadliftTag).toBeDefined();
    const baseSet = { reps: 5, weight: 200, plannedReps: null, plannedWeight: null, distance: null, plannedDistance: null };

    const rpe7 = calculateStrengthStressScore(baseSet, deadliftTag!, 7);
    const rpe10 = calculateStrengthStressScore(baseSet, deadliftTag!, 10);

    expect(rpe7).toBeGreaterThan(0);
    expect(rpe10).toBeGreaterThan(rpe7 * 1.5);
  });

  it("separates easy aerobic CSS from high-intensity cardio CSS", () => {
    const easy = calculateCardioStressScore(log({ duration: 45, rpe: 4 }), []);
    const interval = calculateCardioStressScore(log({ duration: 45, rpe: 10, mainWorkout: "Track intervals" }), []);

    expect(easy).toBeCloseTo(41.4, 1);
    expect(interval).toBeGreaterThan(110);
  });

  it("resolves ACWR zones including insufficient data and danger", () => {
    expect(resolveAcwrZone(null, 0)).toBe("insufficient_data");
    expect(resolveAcwrZone(0.7, 50)).toBe("undertraining");
    expect(resolveAcwrZone(1.1, 50)).toBe("sweet_spot");
    expect(resolveAcwrZone(1.4, 50)).toBe("yellow");
    expect(resolveAcwrZone(1.6, 50)).toBe("danger");
  });

  it("flags posterior-chain overlap and downshifts next-day hill repeats", () => {
    const workoutLogs = [log({ id: "deadlift-day", focus: "Strength", mainWorkout: "Heavy deadlifts", rpe: 9 })];
    const sets = Array.from({ length: 4 }, (_, index) =>
      set({
        workoutLogId: "deadlift-day",
        exerciseName: "deadlift",
        category: "strength",
        setNumber: index + 1,
        reps: 5,
        weight: 200,
      }),
    );
    const summary = calculateTrainingLoad(workoutLogs, sets, [], { currentDate: "2026-05-22" }).overview;
    const suggestions = buildLoadGovernorSuggestions(summary, [
      {
        id: "plan-day-1",
        date: "2026-05-23",
        focus: "Run",
        mainWorkout: "Hill repeats 8x60 seconds",
        exerciseDetails: [
          { exerciseName: "hill_repeats", category: "running", setNumber: 1, time: 40 },
        ],
      },
    ], "2026-05-22");

    expect(summary.activeRestrictions.map((restriction) => restriction.id)).toContain(
      "posterior_chain_velocity_lock",
    );
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].rationaleCode).toBe("posterior_chain_velocity_lock");
    expect(suggestions[0].structuredSetRows?.[0]).toEqual(
      expect.objectContaining({ exerciseName: "recovery_run", planDayId: "plan-day-1" }),
    );
  });

  it("flags anterior-chain braking risk after heavy squats", () => {
    const workoutLogs = [log({ id: "squat-day", focus: "Strength", mainWorkout: "Heavy squats", rpe: 9 })];
    const sets = Array.from({ length: 5 }, (_, index) =>
      set({
        workoutLogId: "squat-day",
        exerciseName: "back_squat",
        setNumber: index + 1,
        reps: 5,
        weight: 185,
      }),
    );
    const summary = calculateTrainingLoad(workoutLogs, sets, [], { currentDate: "2026-05-22" }).overview;
    const suggestions = buildLoadGovernorSuggestions(summary, [
      {
        id: "plan-day-2",
        date: "2026-05-23",
        focus: "Run",
        mainWorkout: "Long road run with downhill finish",
      },
    ], "2026-05-22");

    expect(summary.activeRestrictions.map((restriction) => restriction.id)).toContain(
      "anterior_chain_braking_guard",
    );
    expect(suggestions[0].rationaleCode).toBe("anterior_chain_braking_guard");
  });

  it("flags seven-day elastic tendon overload and speed work", () => {
    const workoutLogs = Array.from({ length: 4 }, (_, index) =>
      log({
        id: `plyo-${index}`,
        date: daysBefore("2026-05-22", index),
        focus: "Plyo",
        mainWorkout: "Jump rope",
        rpe: 8,
      }),
    );
    const sets = workoutLogs.flatMap((workout, workoutIndex) =>
      Array.from({ length: 12 }, (_, setIndex) =>
        set({
          workoutLogId: workout.id,
          exerciseName: "jump_rope",
          category: "conditioning",
          setNumber: setIndex + 1,
          reps: 10,
          weight: 0,
          id: `plyo-${workoutIndex}-${setIndex}`,
        }),
      ),
    );
    const summary = calculateTrainingLoad(workoutLogs, sets, [], { currentDate: "2026-05-22" }).overview;
    const suggestions = buildLoadGovernorSuggestions(summary, [
      {
        id: "plan-day-3",
        date: "2026-05-23",
        focus: "Run",
        mainWorkout: "Track speed intervals",
      },
    ], "2026-05-22");

    expect(summary.activeRestrictions.map((restriction) => restriction.id)).toContain(
      "elastic_tendon_speed_guard",
    );
    expect(suggestions[0].rationaleCode).toBe("elastic_tendon_speed_guard");
  });

  it("uses ACWR danger to lock high-intensity work for the next four days", () => {
    const currentDate = "2026-05-22";
    const baseline = Array.from({ length: 27 }, (_, index) =>
      log({
        id: `base-${index}`,
        date: daysBefore(currentDate, index + 1),
        duration: 10,
        rpe: 4,
        focus: "Run",
        mainWorkout: "Easy run",
      }),
    );
    const spike = log({
      id: "spike",
      date: currentDate,
      duration: 120,
      rpe: 10,
      focus: "Run",
      mainWorkout: "Hard intervals",
    });
    const summary = calculateTrainingLoad([...baseline, spike], [], [], { currentDate }).overview;
    const suggestions = buildLoadGovernorSuggestions(summary, [
      {
        id: "plan-day-4",
        date: "2026-05-25",
        focus: "Strength",
        mainWorkout: "Heavy lower-body lift",
      },
    ], currentDate);

    expect(summary.zone).toBe("danger");
    expect(summary.activeRestrictions.map((restriction) => restriction.id)).toContain("acwr_danger_lock");
    expect(suggestions[0].rationaleCode).toBe("acwr_danger_lock");
  });

  it("uses ACWR yellow to soften near-term high-intensity work", () => {
    const summary: TrainingLoadOverview = {
      currentUtss: 70,
      acuteAvg: 70,
      chronicAvg: 50,
      acwr: 1.4,
      zone: "yellow",
      flaggedVectors: [],
      activeRestrictions: [{
        id: "acwr_yellow_guard",
        label: "ACWR yellow guard",
        severity: "caution",
        expiresOn: "2026-05-24",
        rationale: "Acute load is above the preferred chronic baseline range.",
      }],
      downshiftRationale: "Acute load is above the preferred chronic baseline range.",
      trend: [],
    };

    const suggestions = buildLoadGovernorSuggestions(summary, [
      {
        id: "plan-day-yellow",
        date: "2026-05-23",
        focus: "Run",
        mainWorkout: "Threshold track intervals",
      },
    ], "2026-05-22");

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toEqual(expect.objectContaining({
      rationaleCode: "acwr_yellow_guard",
    }));
    expect(suggestions[0].suggestion.priority).toBe("medium");
  });

  it("creates an undertraining on-ramp instead of restoring peak load", () => {
    const currentDate = "2026-05-22";
    const priorWork = Array.from({ length: 18 }, (_, index) =>
      log({
        id: `prior-${index}`,
        date: daysBefore(currentDate, index + 8),
        duration: 60,
        rpe: 7,
        focus: "Run",
        mainWorkout: "Steady run",
      }),
    );
    const summary = calculateTrainingLoad(priorWork, [], [], { currentDate }).overview;
    const suggestions = buildLoadGovernorSuggestions(summary, [
      {
        id: "plan-day-5",
        date: "2026-05-23",
        focus: "Strength",
        mainWorkout: "Heavy squats and sled pushes",
      },
    ], currentDate);

    expect(summary.zone).toBe("undertraining");
    expect(summary.activeRestrictions.map((restriction) => restriction.id)).toContain("acwr_onramp");
    expect(suggestions[0].rationaleCode).toBe("acwr_onramp");
  });
});
