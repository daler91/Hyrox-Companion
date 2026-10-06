import { describe, expect, it } from "vitest";

import {
  generationPollOutcome,
  getGeneratePlanErrorToast,
  MAX_GENERATION_WAIT_MS,
  MAX_STATUS_OUTAGE_MS,
} from "./usePlanGeneration";

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

// CL47 (CODEBASE_ANALYSIS_2026-10-03): the watch on a generation ends.
describe("generationPollOutcome", () => {
  const startedAt = 1_000_000;
  const poll = {
    generationStatus: "generating",
    isError: false,
    dataUpdatedAt: startedAt + 3_000,
    errorUpdatedAt: 0,
    startedAt,
  };

  it("settles on the server's answer", () => {
    expect(generationPollOutcome({ ...poll, generationStatus: "ready" })).toBe("ready");
    expect(generationPollOutcome({ ...poll, generationStatus: "failed" })).toBe("failed");
  });

  it("keeps waiting while reads succeed within the cap", () => {
    expect(generationPollOutcome(poll)).toBe("waiting");
    expect(
      generationPollOutcome({ ...poll, dataUpdatedAt: startedAt + MAX_GENERATION_WAIT_MS - 1 }),
    ).toBe("waiting");
  });

  it("times out once reads go on past the cap", () => {
    expect(
      generationPollOutcome({ ...poll, dataUpdatedAt: startedAt + MAX_GENERATION_WAIT_MS }),
    ).toBe("timed_out");
  });

  it("gives up on reads that keep failing, counted from the last good one", () => {
    const lastGood = startedAt + 60_000;
    const failing = { ...poll, isError: true, dataUpdatedAt: lastGood };
    expect(
      generationPollOutcome({ ...failing, errorUpdatedAt: lastGood + MAX_STATUS_OUTAGE_MS - 1 }),
    ).toBe("waiting");
    expect(
      generationPollOutcome({ ...failing, errorUpdatedAt: lastGood + MAX_STATUS_OUTAGE_MS }),
    ).toBe("unreachable");
  });

  it("counts a failure before any good read from when the generation started", () => {
    expect(
      generationPollOutcome({
        ...poll,
        generationStatus: undefined,
        isError: true,
        dataUpdatedAt: 0,
        errorUpdatedAt: startedAt + MAX_STATUS_OUTAGE_MS,
      }),
    ).toBe("unreachable");
  });
});
