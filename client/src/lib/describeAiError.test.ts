import { describe, expect, it } from "vitest";

import { AI_COACH_OFF_MESSAGE, describeAiError } from "./describeAiError";

const COPY = {
  rateLimitActivity: "requesting insights",
  slow: "Taking a while.",
  fallback: "Sorry, please try again.",
};

describe("describeAiError", () => {
  // U29 (CODEBASE_ANALYSIS_2026-10-03): retrying cannot clear a consent-off 403.
  it("points a 403 AI_COACH_DISABLED at the Settings switch", () => {
    const error = new Error(
      '403: {"error":"AI coaching is disabled for this account.","code":"AI_COACH_DISABLED"}',
    );
    expect(describeAiError(error, COPY)).toBe(AI_COACH_OFF_MESSAGE);
    expect(AI_COACH_OFF_MESSAGE).toMatch(/Settings/);
  });

  it("keeps the fallback for a 403 with another code", () => {
    const error = new Error('403: {"error":"Nope","code":"FORBIDDEN"}');
    expect(describeAiError(error, COPY)).toBe(COPY.fallback);
  });
});
