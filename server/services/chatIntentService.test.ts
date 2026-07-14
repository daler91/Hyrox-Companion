import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateJsonText } from "../ai/providers";
import {
  classifyPlanEditIntent,
  hasPlanEditKeywords,
  isPlanEditIntent,
  PLAN_EDIT_INTENT_CONFIDENCE_THRESHOLD,
} from "./chatIntentService";

vi.mock("../ai/providers", () => ({
  generateJsonText: vi.fn(),
}));

describe("hasPlanEditKeywords — high-recall gate", () => {
  it.each([
    "hey I want to go to a hyrox class this week",
    "move my long run to Saturday",
    "I need Friday off",
    "can we swap tuesday and wednesday?",
    "make this week easier",
    "I'm on vacation for the next two weeks",
    "I can't train tomorrow",
    "skip today's session",
    "turn Thursday into a rest day",
    "I signed up for a parkrun",
  ])("fires on plan-edit-shaped message: %s", (message) => {
    expect(hasPlanEditKeywords(message)).toBe(true);
  });

  it.each([
    "what is zone 2 training?",
    "how do I improve my wall balls technique?",
    "what's a good pre-workout meal?",
    "explain RPE to me",
  ])("stays silent on plain coaching questions: %s", (message) => {
    expect(hasPlanEditKeywords(message)).toBe(false);
  });
});

describe("classifyPlanEditIntent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the classifier's parsed verdict", async () => {
    vi.mocked(generateJsonText).mockResolvedValue({
      text: JSON.stringify({ intent: "plan_modification", confidence: 0.92 }),
    } as Awaited<ReturnType<typeof generateJsonText>>);

    const result = await classifyPlanEditIntent("move my run to Saturday", [], "user-1");

    expect(result).toEqual({ intent: "plan_modification", confidence: 0.92 });
    expect(generateJsonText).toHaveBeenCalledWith(
      expect.objectContaining({ modelRole: "fast", feature: "chat_intent", userId: "user-1" }),
    );
  });

  it("fails open to normal_chat on garbage JSON", async () => {
    vi.mocked(generateJsonText).mockResolvedValue({
      text: "not json at all",
    } as Awaited<ReturnType<typeof generateJsonText>>);

    const result = await classifyPlanEditIntent("move my run", [], "user-1");

    expect(result.intent).toBe("normal_chat");
  });

  it("fails open to normal_chat on schema-invalid output", async () => {
    vi.mocked(generateJsonText).mockResolvedValue({
      text: JSON.stringify({ intent: "delete_everything", confidence: 5 }),
    } as Awaited<ReturnType<typeof generateJsonText>>);

    const result = await classifyPlanEditIntent("move my run", [], "user-1");

    expect(result.intent).toBe("normal_chat");
  });

  it("fails open to normal_chat when the provider throws", async () => {
    vi.mocked(generateJsonText).mockRejectedValue(new Error("provider down"));

    const result = await classifyPlanEditIntent("move my run", [], "user-1");

    expect(result.intent).toBe("normal_chat");
  });

  it("includes recent user turns for pronoun resolution", async () => {
    vi.mocked(generateJsonText).mockResolvedValue({
      text: JSON.stringify({ intent: "plan_modification", confidence: 0.8 }),
    } as Awaited<ReturnType<typeof generateJsonText>>);

    await classifyPlanEditIntent(
      "do that on Friday instead",
      [
        { role: "user", content: "should I do a tempo run this week?" },
        { role: "assistant", content: "Yes, Thursday would suit." },
      ],
      "user-1",
    );

    const call = vi.mocked(generateJsonText).mock.calls[0][0];
    expect(call.messages[0].content).toContain("should I do a tempo run this week?");
    expect(call.messages[0].content).toContain("do that on Friday instead");
  });
});

describe("isPlanEditIntent", () => {
  it("requires plan_modification at or above the confidence threshold", () => {
    expect(isPlanEditIntent({ intent: "plan_modification", confidence: 0.9 })).toBe(true);
    expect(
      isPlanEditIntent({
        intent: "plan_modification",
        confidence: PLAN_EDIT_INTENT_CONFIDENCE_THRESHOLD,
      }),
    ).toBe(true);
    expect(isPlanEditIntent({ intent: "plan_modification", confidence: 0.5 })).toBe(false);
    expect(isPlanEditIntent({ intent: "normal_chat", confidence: 0.99 })).toBe(false);
  });
});
