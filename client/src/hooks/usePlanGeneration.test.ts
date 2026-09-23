import { describe, expect, it } from "vitest";

import { getGeneratePlanErrorToast } from "./usePlanGeneration";

describe("getGeneratePlanErrorToast", () => {
  it("surfaces a specific message for AI unavailable responses", () => {
    expect(
      getGeneratePlanErrorToast(
        new Error('503: {"error":"AI service temporarily unavailable.","code":"AI_UNAVAILABLE"}'),
      ),
    ).toEqual({
      title: "AI plan generation failed",
      description: "The AI service was temporarily unavailable. Please try again in a moment.",
    });
  });

  it("shows the server's own message, never the raw response", () => {
    expect(
      getGeneratePlanErrorToast(
        new Error(
          '403: {"error":"AI coaching is disabled for this account. Enable it in Settings before using AI features.","code":"AI_COACH_DISABLED"}',
        ),
      ),
    ).toEqual({
      title: "Failed to generate plan",
      description:
        "AI coaching is disabled for this account. Enable it in Settings before using AI features.",
    });
  });

  it("falls back to friendly copy when the response carries no message", () => {
    expect(getGeneratePlanErrorToast(new Error("400: invalid request"))).toEqual({
      title: "Failed to generate plan",
      description: "That didn't work — please check your input and try again.",
    });
  });
});
