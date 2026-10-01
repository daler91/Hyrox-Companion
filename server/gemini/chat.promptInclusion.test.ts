import { describe, expect, it } from "vitest";

import { createMockTrainingContext } from "../../test/factories";
import {
  BASE_SYSTEM_PROMPT,
  buildSystemPrompt,
  CHAT_HR_MEDICATION_GUIDANCE,
  CHAT_RED_FLAG_GUIDANCE,
} from "../prompts";

const CLEAN = { redFlagDetected: false, hrMedicationDetected: false };

/**
 * What reaches the conversational coach's system prompt (chat, chat/stream,
 * coach insights) — the one prompt the athlete talks to directly.
 */
describe("chat system prompt — medical safety", () => {
  const ctx = createMockTrainingContext({ totalWorkouts: 12 });

  it("always carries the standing medical-safety rules", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("MEDICAL SAFETY:");
    expect(buildSystemPrompt(ctx)).toContain("never diagnose");
  });

  it("adds the red-flag guidance only when the athlete's words tripped it", () => {
    expect(buildSystemPrompt(ctx, undefined, undefined, { chatSafety: CLEAN })).not.toContain(
      CHAT_RED_FLAG_GUIDANCE,
    );

    const flagged = buildSystemPrompt(ctx, undefined, undefined, {
      chatSafety: { redFlagDetected: true, hrMedicationDetected: false },
    });
    expect(flagged).toContain(CHAT_RED_FLAG_GUIDANCE);
    expect(flagged).not.toContain(CHAT_HR_MEDICATION_GUIDANCE);
  });

  it("puts the guidance last, after the training data and materials", () => {
    const flagged = buildSystemPrompt(ctx, undefined, ["Excerpt about tapering."], {
      chatSafety: { redFlagDetected: true, hrMedicationDetected: true },
    });
    expect(flagged.endsWith(CHAT_HR_MEDICATION_GUIDANCE)).toBe(true);
    expect(flagged.indexOf("--- END COACHING MATERIALS ---")).toBeLessThan(
      flagged.indexOf(CHAT_RED_FLAG_GUIDANCE),
    );
  });

  it("reaches the athlete with no logged workouts too", () => {
    const prompt = buildSystemPrompt(createMockTrainingContext({ totalWorkouts: 0 }), undefined, undefined, {
      chatSafety: { redFlagDetected: false, hrMedicationDetected: true },
    });
    expect(prompt).toContain("hasn't logged any training data yet");
    expect(prompt).toContain(CHAT_HR_MEDICATION_GUIDANCE);
  });
});

describe("chat system prompt — what a reply can and cannot do", () => {
  it("says a reply cannot change the plan, and how the athlete gets a change", () => {
    const prompt = buildSystemPrompt(createMockTrainingContext({ totalWorkouts: 12 }));
    expect(prompt).toContain("Your reply here cannot change the athlete's plan.");
    expect(prompt).toContain("never say or imply that this reply has moved");
    expect(prompt).toContain('"Move my long run to Saturday"');
  });

  it("says it on day one too, before any workout is logged", () => {
    expect(buildSystemPrompt(createMockTrainingContext({ totalWorkouts: 0 }))).toContain(
      "Your reply here cannot change the athlete's plan.",
    );
  });
});
