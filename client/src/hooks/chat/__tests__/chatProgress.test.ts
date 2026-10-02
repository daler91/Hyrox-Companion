import { CHAT_STATUS_STEPS } from "@shared/chat";
import { describe, expect, it } from "vitest";

import { chatProgressLabel, isChatStatusStep } from "../chatProgress";

describe("chatProgressLabel", () => {
  it("names each step, and says Thinking otherwise", () => {
    expect(chatProgressLabel("reading")).toBe("Reading your training log...");
    expect(chatProgressLabel("drafting_plan")).toBe("Checking your plan...");
    expect(chatProgressLabel("looking_up_workouts")).toBe("Looking through your workouts...");
    expect(chatProgressLabel("thinking")).toBe("Thinking...");
    expect(chatProgressLabel(null)).toBe("Thinking...");
  });

  it("gives every step the server sends words of its own, or Thinking", () => {
    const labels = CHAT_STATUS_STEPS.filter((step) => step !== "thinking").map((step) => chatProgressLabel(step));
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).not.toContain("Thinking...");
  });
});

describe("isChatStatusStep", () => {
  it("accepts the steps the server sends, and nothing else", () => {
    expect(isChatStatusStep("drafting_plan")).toBe(true);
    expect(isChatStatusStep("reading")).toBe(false);
    expect(isChatStatusStep("hacking")).toBe(false);
    expect(isChatStatusStep(true)).toBe(false);
  });
});
