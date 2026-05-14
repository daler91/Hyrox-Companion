import { describe, expect, it } from "vitest";

import { getGeneratePlanErrorToast } from "./usePlanGeneration";

describe("getGeneratePlanErrorToast", () => {
  it("surfaces a specific message for AI unavailable responses", () => {
    expect(
      getGeneratePlanErrorToast(
        new Error('503: {"error":"AI service temporarily unavailable.","code":"AI_UNAVAILABLE"}'),
      ),
    ).toEqual({
      title: "AI plan generation timed out",
      description: "The AI service took too long or was temporarily unavailable. Please try again in a moment.",
    });
  });

  it("keeps the generic failure message for non-AI errors", () => {
    expect(getGeneratePlanErrorToast(new Error("400: invalid request"))).toEqual({
      title: "Failed to generate plan",
      description: "400: invalid request",
    });
  });
});
