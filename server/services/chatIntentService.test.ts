import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateJsonText } from "../ai/providers";
import {
  classifyPlanEditIntent,
  findCoachOffer,
  hasPlanEditKeywords,
  isPlanEditIntent,
  isShortConfirmation,
  mayRequestPlanEdit,
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

const COACH_OFFER = {
  role: "assistant" as const,
  content: "Your legs sound heavy after Tuesday. Want me to move your long run to Saturday?",
};
const COACH_ADVICE = {
  role: "assistant" as const,
  content: "I can see your RPE climbing this week, so keep the easy runs truly easy.",
};

describe("isShortConfirmation", () => {
  it.each(["yes please", "Yes, do it", "go ahead", "sounds good!", "ok", "let's do that", "Sure thing"])(
    "recognises: %s",
    (message) => {
      expect(isShortConfirmation(message)).toBe(true);
    },
  );

  it.each([
    "no thanks",
    "what about Friday?",
    "yes, and while you're at it can you explain why my wall balls feel so slow at the end of every session?",
  ])("rejects: %s", (message) => {
    expect(isShortConfirmation(message)).toBe(false);
  });
});

describe("findCoachOffer", () => {
  it("returns the coach's last turn when it offered a plan change", () => {
    expect(findCoachOffer([{ role: "user", content: "legs are dead" }, COACH_OFFER])).toBe(COACH_OFFER.content);
  });

  it("ignores advice that only uses offer-like words", () => {
    expect(findCoachOffer([COACH_ADVICE])).toBeUndefined();
  });

  it("looks only at the last turn, and only when the coach wrote it", () => {
    expect(findCoachOffer([COACH_OFFER, { role: "user", content: "hmm" }])).toBeUndefined();
    expect(findCoachOffer([])).toBeUndefined();
  });
});

describe("mayRequestPlanEdit", () => {
  it("lets a confirmation of an offered change through", () => {
    expect(mayRequestPlanEdit("yes please", [COACH_OFFER])).toBe(true);
  });

  it("keeps a confirmation of plain advice out", () => {
    expect(mayRequestPlanEdit("yes please", [COACH_ADVICE])).toBe(false);
  });

  it("still fires on the message's own keywords", () => {
    expect(mayRequestPlanEdit("move my long run to Saturday", [])).toBe(true);
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
      expect.objectContaining({
        modelRole: "fast",
        reasoningEffort: "none",
        feature: "chat_intent",
        userId: "user-1",
      }),
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

  it("shows the coach's offer when the message confirms it", async () => {
    vi.mocked(generateJsonText).mockResolvedValue({
      text: JSON.stringify({ intent: "plan_modification", confidence: 0.9 }),
    } as Awaited<ReturnType<typeof generateJsonText>>);

    await classifyPlanEditIntent("yes please", [COACH_OFFER], "user-1");

    const content = vi.mocked(generateJsonText).mock.calls[0][0].messages[0].content;
    expect(content).toContain("<coach_message>");
    expect(content).toContain("move your long run to Saturday");
  });

  it("leaves the coach's turn out for anything but a confirmation", async () => {
    vi.mocked(generateJsonText).mockResolvedValue({
      text: JSON.stringify({ intent: "normal_chat", confidence: 0.9 }),
    } as Awaited<ReturnType<typeof generateJsonText>>);

    await classifyPlanEditIntent("why Saturday though?", [COACH_OFFER], "user-1");

    expect(vi.mocked(generateJsonText).mock.calls[0][0].messages[0].content).not.toContain("<coach_message>");
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
