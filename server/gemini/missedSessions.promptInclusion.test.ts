import { describe, expect, it } from "vitest";

import { createMockTrainingContext, createMockUpcomingWorkout } from "../../test/factories";
import { SUGGESTIONS_PROMPT } from "../prompts";
import { buildSuggestionsPrompt } from "./suggestionService";

/**
 * A missed session has to reach the prompt that rewrites upcoming sessions,
 * with what to do about it: the coach used to be told only what not to do,
 * so a miss changed nothing in what it wrote next.
 */
const QUIET_INSIGHTS = {
  rpeTrend: "stable" as const,
  fatigueFlag: false,
  undertrainingFlag: false,
  stationGaps: [],
  progressionFlags: [],
};

describe("buildSuggestionsPrompt — missed sessions", () => {
  const missedThreshold = {
    date: "2026-06-11",
    focus: "Threshold run",
    priority: "key" as const,
    decision: "let_go" as const,
    movable: false,
    daysAgo: 1,
    mainWorkout: "5x1 km @ 4:10/km, 90 s jog",
  };

  it("tells the coach what was missed and how to coach around it", () => {
    const ctx = createMockTrainingContext({
      coachingInsights: { ...QUIET_INSIGHTS, recentMisses: [missedThreshold] },
    });

    const prompt = buildSuggestionsPrompt(ctx, [createMockUpcomingWorkout()], "goal");

    expect(prompt).toContain(
      "- Thursday 2026-06-11 (yesterday): Threshold run (key, let go). It was: 5x1 km @ 4:10/km, 90 s jog",
    );
    expect(prompt).toContain("How to coach around a missed session:");
    expect(prompt).toContain("repeats the missed step instead of progressing past it");
  });

  it("says nothing about misses for an athlete who missed none", () => {
    const ctx = createMockTrainingContext({ coachingInsights: { ...QUIET_INSIGHTS, recentMisses: [] } });

    const prompt = buildSuggestionsPrompt(ctx, [createMockUpcomingWorkout()], "goal");

    expect(prompt).not.toContain("MISSED SESSION");
  });

  it("makes the system prompt act on a miss, and never by adding work", () => {
    // The response rule: the sessions after a miss should show it.
    expect(SUGGESTIONS_PROMPT).toContain(
      '- RECENT MISSED SESSIONS: when this section is present, the sessions after a miss should show it.',
    );
    expect(SUGGESTIONS_PROMPT).toContain("Return no modification for a miss the athlete can still move.");
    // The hard constraint that keeps it from turning into catching up.
    expect(SUGGESTIONS_PROMPT).toContain("A MISSED SESSION never adds work");
  });
});
