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
});
