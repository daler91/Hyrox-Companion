/**
 * One failed chunk ends a plan generation's AI calls: the chunks still running
 * are cancelled and the queued ones never reach the model. p-limit used to go
 * on starting them after Promise.all had rejected, each a billed reasoning call.
 * PF15 (CODEBASE_ANALYSIS_2026-10-03).
 */
import type { GeneratePlanInput } from "@shared/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { executePlanGeneration } from "./planGenerationService";

const mocks = vi.hoisted(() => ({
  generateJsonText: vi.fn(),
  transaction: vi.fn(),
  plans: { updateGenerationStatus: vi.fn() },
  users: { getUser: vi.fn() },
  analytics: {
    getWorkoutLogsByDateRange: vi.fn(),
    getAllExerciseSetsWithDates: vi.fn(),
    getExerciseLoadTags: vi.fn(),
  },
  timelineAnnotations: { list: vi.fn() },
  athleteFacts: { list: vi.fn() },
}));

vi.mock("../db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("../ai/providers", () => ({ generateJsonText: mocks.generateJsonText }));
vi.mock("../logger", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock("../storage", () => ({
  storage: {
    plans: mocks.plans,
    users: mocks.users,
    analytics: mocks.analytics,
    timelineAnnotations: mocks.timelineAnnotations,
    athleteFacts: mocks.athleteFacts,
  },
}));

// Monday 5 Jan to the race on Sunday 21 Jun: 24 weeks, twelve two-week chunks.
const input: GeneratePlanInput = {
  goal: "Hyrox race prep",
  daysPerWeek: 3,
  experienceLevel: "intermediate",
  startDate: "2026-01-05",
  endDate: "2026-06-21",
  endDateIsRaceDate: true,
};

describe("executePlanGeneration when a chunk fails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.plans.updateGenerationStatus.mockResolvedValue(null);
    mocks.users.getUser.mockResolvedValue({ weightUnit: "kg", distanceUnit: "km" });
    mocks.analytics.getWorkoutLogsByDateRange.mockResolvedValue([]);
    mocks.analytics.getAllExerciseSetsWithDates.mockResolvedValue([]);
    mocks.analytics.getExerciseLoadTags.mockResolvedValue([]);
    mocks.timelineAnnotations.list.mockResolvedValue([]);
    mocks.athleteFacts.list.mockResolvedValue([]);
  });

  it("cancels the chunks running and starts none of the rest", async () => {
    const failure = new Error("AI call timed out after 90000ms (planGeneration:w1-2)");
    const signals: AbortSignal[] = [];
    mocks.generateJsonText.mockImplementation(({ signal }: { signal: AbortSignal }) => {
      signals.push(signal);
      const isFirst = signals.length === 1;
      return new Promise((resolve, reject) => {
        // The first chunk fails; the others run until they are cancelled.
        if (isFirst) setTimeout(() => reject(failure), 1);
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });

    await expect(executePlanGeneration("plan-1", input, "user-1")).rejects.toBe(failure);
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });

    // The three chunks already running, of twelve.
    expect(mocks.generateJsonText.mock.calls.map(([request]) => request.label)).toEqual([
      "planGeneration:w1-2",
      "planGeneration:w3-4",
      "planGeneration:w5-6",
    ]);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.plans.updateGenerationStatus).toHaveBeenCalledWith(
      "plan-1",
      "failed",
      "Plan generation failed unexpectedly. Please try again.",
    );
  });

  it("starts no chunk when the job was cancelled before generation began", async () => {
    const shutdown = new AbortController();
    shutdown.abort(new Error("worker shutting down"));

    await expect(executePlanGeneration("plan-1", input, "user-1", shutdown.signal)).rejects.toThrow(
      "worker shutting down",
    );

    expect(mocks.generateJsonText).not.toHaveBeenCalled();
  });
});
