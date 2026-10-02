import { describe, expect, it } from "vitest";

import type { TrainingContext, WorkoutSuggestion } from "../gemini";
import {
  analyzeChatSafety,
  analyzeSafetySignals,
  applySafetyLayerToSuggestions,
  buildChatSafetyNotice,
  buildSafetyReviewNote,
} from "./aiSafety";

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

  it("reads the athlete card the same way: the medication scan, never the red-flag scan", () => {
    const fact = (text: string) => ({ fact: text, category: "constraint" as const, reviewOn: "2026-12-30" });
    const workouts = [{ id: "w1", date: "2026-05-02", focus: "run", mainWorkout: "easy", notes: "" }];

    const medicated = analyzeSafetySignals({ ...baseTrainingContext, athleteFacts: [fact("On beta blockers")] }, workouts);
    expect(medicated.hrMedicationDetected).toBe(true);

    const history = analyzeSafetySignals(
      { ...baseTrainingContext, athleteFacts: [fact("Had chest pain in 2024, cleared by my cardiologist")] },
      workouts,
    );
    expect(history.redFlagDetected).toBe(false);
  });
});

describe("analyzeChatSafety", () => {
  it("flags red-flag symptoms in the athlete's chat message", () => {
    const signals = analyzeChatSafety("I had chest pain on my last two runs, should I still do intervals?", []);
    expect(signals).toEqual({ redFlagDetected: true, hrMedicationDetected: false });
  });

  it("keeps the flag for the follow-up to that message", () => {
    const signals = analyzeChatSafety("ok, so what should I do tomorrow?", [
      { role: "user", content: "I nearly fainted at the end of my tempo run" },
      { role: "assistant", content: "That needs checking before anything else." },
    ]);
    expect(signals.redFlagDetected).toBe(true);
  });

  it("looks back only one athlete turn", () => {
    const signals = analyzeChatSafety("what about my long run on Sunday?", [
      { role: "user", content: "I had chest pain on Monday" },
      { role: "assistant", content: "Please get that checked." },
      { role: "user", content: "Saw the GP, all clear." },
      { role: "assistant", content: "Great news." },
    ]);
    expect(signals.redFlagDetected).toBe(false);
  });

  it("never reads the coach's own replies, which can quote the escalation", () => {
    const signals = analyzeChatSafety("thanks", [
      { role: "user", content: "how do I pace a 5k?" },
      { role: "assistant", content: "If you ever get chest pain or shortness of breath, stop and get checked." },
    ]);
    expect(signals).toEqual({ redFlagDetected: false, hrMedicationDetected: false });
  });

  it("flags heart-rate medication separately", () => {
    expect(analyzeChatSafety("I'm on bisoprolol, which zones should I use?", [])).toEqual({
      redFlagDetected: false,
      hrMedicationDetected: true,
    });
  });
});

describe("buildChatSafetyNotice", () => {
  it("returns no notice for a clean conversation", () => {
    expect(buildChatSafetyNotice({ redFlagDetected: false, hrMedicationDetected: false })).toBeNull();
  });

  it("shows the urgent escalation, which outranks the medication disclaimer", () => {
    const notice = buildChatSafetyNotice({ redFlagDetected: true, hrMedicationDetected: true });
    expect(notice?.level).toBe("urgent");
    expect(notice?.message).toMatch(/seek prompt medical care/i);
  });

  it("shows the medication disclaimer as a caution", () => {
    const notice = buildChatSafetyNotice({ redFlagDetected: false, hrMedicationDetected: true });
    expect(notice?.level).toBe("caution");
    expect(notice?.message).toMatch(/Heart-rate zones can be unreliable/);
  });
});
