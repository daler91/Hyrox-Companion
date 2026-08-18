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

  it("removes repeated prohibited medical phrases", () => {
    const safety = { redFlagDetected: false, hrMedicationDetected: false };
    const repeatedSuggestion: WorkoutSuggestion = {
      ...baseSuggestion,
      recommendation: "Diagnose this. Diagnose again. Increase your medication dose and increase your medication dose.",
      rationale: "Prescribe therapy and prescribe therapy.",
    };

    const out = applySafetyLayerToSuggestions([repeatedSuggestion], safety);
    expect(out[0].recommendation).not.toMatch(/diagnose/i);
    expect(out[0].recommendation).not.toMatch(/increase your medication dose/i);
    expect(out[0].rationale).not.toMatch(/prescribe/i);
  });

  it("does not self-trigger red flags from prior AI escalation text", () => {
    const safety = analyzeSafetySignals(
      {
        ...baseTrainingContext,
        recentWorkouts: [{ date: "2026-05-01", focus: "run", mainWorkout: "easy", status: "done", athleteNote: null }],
      },
      [{
        id: "w1",
        date: "2026-05-02",
        focus: "run",
        mainWorkout: "easy",
        notes: "[AI Coach] I noticed symptoms that can signal a potentially serious medical issue. Pause hard training and seek prompt medical care. If symptoms are severe, worsening, or include chest pain, fainting, or trouble breathing, seek emergency care now.",
      }],
    );

    expect(safety.redFlagDetected).toBe(false);
  });

  it("fires the HR-medication disclaimer from the athlete's standing constraints", () => {
    // "on beta blockers" typed into Injuries & Limitations sits in every
    // prompt; the deterministic disclaimer must fire from the same text or the
    // app looks like it was told and ignored it (coach-memory-spec §5.2).
    const safety = analyzeSafetySignals(
      { ...baseTrainingContext, trainingConstraints: "On beta blockers for blood pressure" },
      [{ id: "w1", date: "2026-05-02", focus: "run", mainWorkout: "zone 3", notes: "" }],
    );

    expect(safety.hrMedicationDetected).toBe(true);
    expect(safety.redFlagDetected).toBe(false);
  });

  it("never red-flags from the standing constraints, only from dated workout text", () => {
    // A red flag REPLACES every suggestion with an escalation. A durable
    // constraint mentioning past chest pain has no end date — feeding it to
    // the red-flag scan would brick auto-coach forever.
    const safety = analyzeSafetySignals(
      { ...baseTrainingContext, trainingConstraints: "History of chest pain in 2024, cleared by cardiologist" },
      [{ id: "w1", date: "2026-05-02", focus: "run", mainWorkout: "easy", notes: "" }],
    );

    expect(safety.redFlagDetected).toBe(false);
    // The same words in a dated athlete note still escalate.
    const dated = analyzeSafetySignals(
      { ...baseTrainingContext, recentWorkouts: [{ date: "2026-05-01", focus: "run", mainWorkout: "easy", status: "done", athleteNote: "chest pain on the last rep" }] },
      [],
    );
    expect(dated.redFlagDetected).toBe(true);
  });
});
