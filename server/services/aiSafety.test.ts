import { describe, expect, it } from "vitest";

import type { TrainingContext, WorkoutSuggestion } from "../gemini";
import { analyzeSafetySignals, applySafetyLayerToSuggestions, buildSafetyReviewNote } from "./aiSafety";

const baseTrainingContext: TrainingContext = {
  totalWorkouts: 0,
  completedWorkouts: 0,
  plannedWorkouts: 0,
  missedWorkouts: 0,
  skippedWorkouts: 0,
  completionRate: 0,
  currentStreak: 0,
  recentWorkouts: [],
  exerciseBreakdown: {},
};

const baseSuggestion: WorkoutSuggestion = {
  workoutId: "w1",
  workoutDate: "2026-05-02",
  workoutFocus: "run",
  targetField: "notes",
  action: "append",
  recommendation: "Diagnose overtraining and increase your medication dose.",
  rationale: "Prescribe therapy changes.",
  priority: "medium",
};

describe("aiSafety", () => {
  it("forces escalation note when red-flag symptoms are present", () => {
    const safety = analyzeSafetySignals(
      { ...baseTrainingContext, recentWorkouts: [{ date: "2026-05-01", focus: "run", mainWorkout: "easy", status: "done", athleteNote: "Chest pain during cooldown" }] },
      [{ id: "w1", date: "2026-05-02", focus: "run", mainWorkout: "easy", notes: "" }],
    );

    expect(safety.redFlagDetected).toBe(true);
    expect(buildSafetyReviewNote(safety)).toMatch(/seek prompt medical care/i);
  });

  it("adds HR medication disclaimer and strips prohibited medical actions", () => {
    const safety = analyzeSafetySignals(
      { ...baseTrainingContext, recentWorkouts: [{ date: "2026-05-01", focus: "run", mainWorkout: "easy", status: "done", athleteNote: "Started metoprolol" }] },
      [{ id: "w1", date: "2026-05-02", focus: "run", mainWorkout: "zone 3", notes: "" }],
    );
    const out = applySafetyLayerToSuggestions([baseSuggestion], safety);

    expect(safety.hrMedicationDetected).toBe(true);
    expect(out[0].recommendation).toContain("Heart-rate zones can be unreliable");
    expect(out[0].recommendation).not.toMatch(/increase your medication dose/i);
    expect(out[0].rationale).not.toMatch(/Prescribe/i);
  });
});
