import { describe, expect, it } from "vitest";

import { createMockTrainingContext, createMockUpcomingWorkout } from "../../test/factories";
import { buildSystemPrompt, PLAN_ADJUSTMENT_PROMPT, SUGGESTIONS_PROMPT } from "../prompts";
import { buildExerciseSelectionBrief } from "../services/ai/exerciseSelection";
import { buildPlanAdjustmentUserPrompt } from "./planAdjustmentService";
import { buildSuggestionsPrompt } from "./suggestionService";

/**
 * The exercise-selection brief has to reach every prompt that chooses or
 * swaps exercises — the auto-coach, its review notes (same data sections),
 * chat, and chat plan edits. Companion to suggestionService.promptInclusion,
 * which pins the brief into its kitchen-sink context and section ordering.
 */
describe("exercise selection brief — reaches every prompt that chooses exercises", () => {
  // Built by the real builder from real-shaped logs, so this also proves the
  // two halves (computing the brief, rendering it) fit together.
  const benchDays = ["2026-04-06", "2026-04-09", "2026-04-13", "2026-04-16"];
  const brief = buildExerciseSelectionBrief({
    goal: "HYROX Open",
    experienceLevel: "intermediate",
    today: "2026-04-20",
    weightUnit: "kg",
    distanceUnit: "km",
    sets: benchDays
      .flatMap((date) =>
        [1, 2, 3, 4, 5].map(() => ({
          exerciseName: "bench_press",
          date,
          workoutLogId: `log-${date}`,
          reps: 5,
          weight: 80,
          weightUnit: "kg",
        })),
      )
      .concat(
        benchDays.flatMap((date) =>
          [1, 2, 3].map(() => ({
            exerciseName: "back_squat",
            date,
            workoutLogId: `log-${date}`,
            reps: 5,
            weight: 100,
            weightUnit: "kg",
          })),
        ),
      ),
    stationGaps: [{ station: "wall_balls", daysSince: 16 }],
    upcoming: [
      { date: "2026-04-21", sets: [{ exerciseName: "bench_press", weight: 80 }] },
      { date: "2026-04-22", sets: [{ exerciseName: "back_squat", weight: 100 }] },
    ],
    division: "open",
    gender: "female",
  });
  const ctx = createMockTrainingContext({ totalWorkouts: 20, exerciseSelection: brief });

  it("gives the auto-coach the athlete's staples, needs, race loads and week shape", () => {
    const prompt = buildSuggestionsPrompt(ctx, [createMockUpcomingWorkout()], "HYROX Open");
    expect(prompt).toContain("- Bench Press: 4 sessions, last 5 sets, top 80 kg x 5");
    expect(prompt).toContain(
      "Wall Balls: not trained for 16 days → Wall Balls, Dumbbell Thruster, Front Squat, Push Press",
    );
    expect(prompt).toContain(
      "Back Squat has stalled at 100 kg x 5 for 3 sessions → Front Squat, Box Squat",
    );
    expect(prompt).toContain("RACE STANDARDS (open, women: sled push 102 kg");
    expect(prompt).toContain("UPCOMING WEEK SHAPE (2 of 2 upcoming days have exercise tables)");
  });

  it("names exercises the way the athlete reads them — never as snake_case keys", () => {
    const prompt = buildSuggestionsPrompt(ctx, [createMockUpcomingWorkout()], "HYROX Open");
    const briefBlock = prompt.slice(
      prompt.indexOf("EXERCISE SELECTION BRIEF"),
      prompt.indexOf("END EXERCISE SELECTION BRIEF"),
    );
    expect(briefBlock).not.toMatch(/\b[a-z]+_[a-z_]+\b(?! work)/);
  });

  it("gives the chat coach the same brief", () => {
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("EXERCISE SELECTION BRIEF");
    expect(prompt).toContain("- Bench Press: 4 sessions");
    expect(prompt).toContain('When an "EXERCISE SELECTION BRIEF" is provided');
  });

  it("gives chat plan edits the same brief to pick substitutes from", () => {
    const prompt = buildPlanAdjustmentUserPrompt({
      trainingContext: ctx,
      upcomingWorkouts: [createMockUpcomingWorkout()],
      structureBlockDayIds: new Set(),
      userMessage: "swap tomorrow's bench for something else",
      history: [],
    });
    expect(prompt).toContain("EXERCISE SELECTION BRIEF");
    expect(PLAN_ADJUSTMENT_PROMPT).toContain("choose it from the EXERCISE SELECTION BRIEF");
  });

  it("states how to choose and how specifically to prescribe in the suggestions system prompt", () => {
    expect(SUGGESTIONS_PROMPT).toContain(
      "EXERCISE SELECTION (how to choose, swap, and progress exercises",
    );
    expect(SUGGESTIONS_PROMPT).toContain("PRESCRIPTION DETAIL");
    expect(SUGGESTIONS_PROMPT).toContain('"Back Squat 4x5 @ 100 kg (RPE 7, rest 2-3 min)"');
    // Station gaps are HYROX-only: a marathoner is never told to sled push.
    expect(SUGGESTIONS_PROMPT).toContain(
      "act on them only when the athlete's goal involves functional fitness/Hyrox",
    );
  });

  it("adds nothing when the context carries no brief", () => {
    const prompt = buildSuggestionsPrompt(
      createMockTrainingContext(),
      [createMockUpcomingWorkout()],
      "goal",
    );
    expect(prompt).not.toContain("EXERCISE SELECTION BRIEF");
  });
});
