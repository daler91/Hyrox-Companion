import { describe, expect, it } from "vitest";
import { decideTrainingState, type TrainingDecisionInput } from "./trainingDecisionEngine";

const baseInput: TrainingDecisionInput = {
  profile: { experienceLevel: "intermediate", primaryGoal: "improve" },
  latestWorkouts: { completedLast7d: 4, avgRpeLast3: 6.5 },
  testTrend: { direction: "flat" },
  raceContext: { hasRace: false, daysToRace: null },
  recoveryMarkers: { sleepQuality: "good", soreness: "low", restingHrDelta: 0, illnessFlag: false },
};

describe("decideTrainingState", () => {
  it("covers phase-assignment transitions across reset -> base -> bridge -> performance", () => {
    const reset = decideTrainingState({ ...baseInput, latestWorkouts: { completedLast7d: 1, avgRpeLast3: 5 }, profile: { experienceLevel: "beginner", primaryGoal: "finish" } });
    const base = decideTrainingState({ ...baseInput, testTrend: { direction: "declining" } });
    const bridge = decideTrainingState({ ...baseInput, raceContext: { hasRace: true, daysToRace: 21 } });
    const performance = decideTrainingState({
      ...baseInput,
      profile: { experienceLevel: "advanced", primaryGoal: "podium" },
      testTrend: { direction: "improving" },
      raceContext: { hasRace: true, daysToRace: 20 },
    });

    expect(reset.phase).toBe("reset_repair");
    expect(base.phase).toBe("aerobic_base");
    expect(bridge.phase).toBe("bridge");
    expect(performance.phase).toBe("performance");
  });

  it("returns reset_repair with intensity blocked on hard recovery stop", () => {
    const result = decideTrainingState({ ...baseInput, recoveryMarkers: { ...baseInput.recoveryMarkers, illnessFlag: true } });
    expect(result.phase).toBe("reset_repair");
    expect(result.intensityPermitted).toBe(false);
    expect(result.rationaleCodes).toContain("S1_HARD_RECOVERY_STOP");
  });

  it("protects race week and blocks high intensity", () => {
    const result = decideTrainingState({ ...baseInput, raceContext: { hasRace: true, daysToRace: 5 } });
    expect(result.phase).toBe("performance");
    expect(result.intensityPermitted).toBe(false);
    expect(result.allowedWorkoutTypes).toEqual(["mobility", "easy_aerobic", "race_pace"]);
    expect(result.rationaleCodes).toContain("S3_RACE_WEEK");
  });

  it("permits performance when trend is improving and recovery is clean", () => {
    const result = decideTrainingState({
      ...baseInput,
      testTrend: { direction: "improving" },
      raceContext: { hasRace: true, daysToRace: 21 },
      profile: { experienceLevel: "advanced", primaryGoal: "podium" },
    });
    expect(result.phase).toBe("performance");
    expect(result.intensityPermitted).toBe(true);
    expect(result.rationaleCodes).toContain("S8_INTENSITY_ALLOWED");
  });

  it("suppresses intensity in strict/guarded states", () => {
    const softRecovery = decideTrainingState({
      ...baseInput,
      raceContext: { hasRace: true, daysToRace: 21 },
      recoveryMarkers: { ...baseInput.recoveryMarkers, sleepQuality: "poor" },
      testTrend: { direction: "improving" },
    });

    expect(softRecovery.phase).toBe("aerobic_base");
    expect(softRecovery.intensityPermitted).toBe(false);
    expect(softRecovery.rationaleCodes).toContain("S2_SOFT_RECOVERY_GUARD");
    expect(softRecovery.rationaleCodes).toContain("S8_INTENSITY_BLOCKED");
  });
});
