import { describe, expect, it } from "vitest";

import { createMockTrainingContext, createMockUpcomingWorkout } from "../../test/factories";
import { buildSystemPrompt, SUGGESTIONS_PROMPT } from "../prompts";
import { buildTrainingTargets } from "../services/workoutEngine/trainingTargets";
import { buildSuggestionsPrompt } from "./suggestionService";

/**
 * The athlete's current numbers have to reach the prompts that prescribe
 * loads and paces — the auto-coach and chat — so their numbers agree with
 * the plan the engine built and keeps adapting.
 */
describe("training targets — reach the prompts that prescribe loads", () => {
  const trainingTargets = buildTrainingTargets({
    sets: ["2026-09-02", "2026-09-09"].map((date) => ({
      exerciseName: "front_squat",
      workoutLogId: `log-${date}`,
      date,
      reps: 5,
      weight: 85,
      weightUnit: "kg",
    })),
    logs: [
      { id: "r1", date: "2026-09-04", focus: "Run", distanceMeters: 5000, duration: 24 },
      { id: "r2", date: "2026-09-11", focus: "Run", distanceMeters: 8000, duration: 45 },
    ],
    weightUnit: "kg",
    distanceUnit: "km",
  })!;
  const ctx = createMockTrainingContext({ totalWorkouts: 12, trainingTargets });
  const line =
    "- Front Squat: est. 1RM 104.8 kg (from 85 kg x 5 on 2026-09-09) → 5 reps @ RPE 8 ≈ 85 kg · 8 reps @ RPE 8 ≈ 77.5 kg";

  it("gives the auto-coach the athlete's estimated 1RMs and paces", () => {
    const prompt = buildSuggestionsPrompt(ctx, [createMockUpcomingWorkout()], "HYROX Open");
    expect(prompt).toContain("TRAINING TARGETS (computed from the athlete's logs");
    expect(prompt).toContain(line);
    expect(prompt).toMatch(/- Run paces: easy \d:\d\d-\d:\d\d\/km · steady/);
  });

  it("gives the chat coach the same numbers", () => {
    expect(buildSystemPrompt(ctx)).toContain(line);
  });

  it("tells the coach to prescribe from them and to keep auto-progressed loads", () => {
    expect(SUGGESTIONS_PROMPT).toContain("Anchor loads on TRAINING TARGETS when given");
    expect(SUGGESTIONS_PROMPT).toContain('carry an "Auto-progression" note');
  });

  it("stays out of the prompt when there are no targets", () => {
    const bare = createMockTrainingContext({ totalWorkouts: 12 });
    expect(buildSuggestionsPrompt(bare, [createMockUpcomingWorkout()], "HYROX Open")).not.toContain(
      "TRAINING TARGETS",
    );
  });
});
