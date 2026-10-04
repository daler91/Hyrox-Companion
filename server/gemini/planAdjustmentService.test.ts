import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateJsonText, streamText } from "../ai/providers";
import {
  buildPlanAdjustmentUserPrompt,
  generatePlanAdjustment,
  parseAndValidatePlanAdjustment,
} from "./planAdjustmentService";
import type { TrainingContext } from "./types";

vi.mock("../ai/providers", async () => ({
  generateJsonText: vi.fn(),
  streamText: vi.fn(),
  stripJsonCodeFence: (await import("../ai/providers/anthropic")).stripJsonCodeFence,
}));

function validChange(overrides: Record<string, unknown> = {}) {
  return {
    planDayId: "day-1",
    updatedFields: { mainWorkout: "5x1km run at race pace" },
    rationale: "Practices race pacing before the event.",
    ...overrides,
  };
}

describe("parseAndValidatePlanAdjustment", () => {
  it("returns the validated envelope", () => {
    const result = parseAndValidatePlanAdjustment(
      JSON.stringify({ summaryMessage: "Swapped Thursday for your class.", changes: [validChange()] }),
    );

    expect(result).not.toBeNull();
    expect(result?.summaryMessage).toBe("Swapped Thursday for your class.");
    expect(result?.changes).toHaveLength(1);
    expect(result?.changes[0].planDayId).toBe("day-1");
  });

  it("returns null on unparseable JSON", () => {
    expect(parseAndValidatePlanAdjustment("not json")).toBeNull();
  });

  it("returns null when the envelope is missing a summaryMessage", () => {
    expect(
      parseAndValidatePlanAdjustment(JSON.stringify({ changes: [validChange()] })),
    ).toBeNull();
  });

  it("drops invalid changes but keeps the valid ones", () => {
    const result = parseAndValidatePlanAdjustment(
      JSON.stringify({
        summaryMessage: "Two changes.",
        changes: [
          validChange(),
          { planDayId: "day-2" }, // no updatedFields
          { planDayId: "day-3", updatedFields: {}, rationale: "empty fields" },
          validChange({ planDayId: "day-4", updatedFields: { expectedRpe: 99 } }), // out of range
        ],
      }),
    );

    expect(result?.changes.map((c) => c.planDayId)).toEqual(["day-1"]);
  });

  it("accepts an empty changes array (coach declines / clarifies)", () => {
    const result = parseAndValidatePlanAdjustment(
      JSON.stringify({ summaryMessage: "Which day do you mean?", changes: [] }),
    );

    expect(result?.changes).toEqual([]);
  });

  it("normalizes ampersands in summary, rationale, and text fields", () => {
    const result = parseAndValidatePlanAdjustment(
      JSON.stringify({
        summaryMessage: "Strength & conditioning day updated.",
        changes: [
          validChange({
            updatedFields: { mainWorkout: "Squats & lunges", notes: "Slow & controlled" },
            rationale: "Balance & recovery",
          }),
        ],
      }),
    );

    expect(result?.summaryMessage).toBe("Strength and conditioning day updated.");
    expect(result?.changes[0].updatedFields.mainWorkout).toBe("Squats and lunges");
    expect(result?.changes[0].updatedFields.notes).toBe("Slow and controlled");
    expect(result?.changes[0].rationale).toBe("Balance and recovery");
  });

  it("caps the number of changes at 14", () => {
    const changes = Array.from({ length: 20 }, (_, i) =>
      validChange({ planDayId: `day-${i}` }),
    );
    const result = parseAndValidatePlanAdjustment(
      JSON.stringify({ summaryMessage: "Lots of changes.", changes }),
    );

    expect(result?.changes).toHaveLength(14);
  });
});

describe("buildPlanAdjustmentUserPrompt", () => {
  const trainingContext = {
    completionRate: 80,
    currentStreak: 3,
    completedWorkouts: 12,
    currentDate: "2026-07-14",
    exerciseBreakdown: {},
    structuredExerciseStats: {},
    recentWorkouts: [],
  } as unknown as TrainingContext;

  const upcomingWorkouts = [
    { id: "day-1", date: "2026-07-16", focus: "Tempo Run", mainWorkout: "40min tempo" },
    { id: "day-2", date: "2026-07-17", focus: "EMOM", mainWorkout: "EMOM 20" },
  ];

  it("includes day IDs, structure-block restrictions, focus hint, and the sanitized request", () => {
    const prompt = buildPlanAdjustmentUserPrompt({
      trainingContext,
      upcomingWorkouts,
      structureBlockDayIds: new Set(["day-2"]),
      userMessage: "I want to go to a hyrox class <b>this week</b>",
      history: [{ role: "user", content: "how was my week?" }],
      focusPlanDayId: "day-1",
    });

    expect(prompt).toContain("ID: day-1");
    expect(prompt).toContain("ID: day-2");
    expect(prompt).toContain("STRUCTURE-BLOCK DAYS");
    expect(prompt).toContain("day-2");
    expect(prompt).toContain("FOCUSED DAY");
    expect(prompt).toContain("<user_input>");
    // XML-ish user content is entity-encoded so it can't break the tags.
    expect(prompt).toContain("&lt;b&gt;this week&lt;/b&gt;");
    expect(prompt).toContain("--- RECENT CONVERSATION ---");
    expect(prompt).toContain("Athlete: how was my week?");
  });

  it("omits optional sections when their inputs are absent", () => {
    const prompt = buildPlanAdjustmentUserPrompt({
      trainingContext,
      upcomingWorkouts,
      structureBlockDayIds: new Set(),
      userMessage: "make friday easier",
      history: [],
    });

    expect(prompt).not.toContain("STRUCTURE-BLOCK DAYS");
    expect(prompt).not.toContain("FOCUSED DAY");
    expect(prompt).not.toContain("--- RECENT CONVERSATION ---");
    expect(prompt).not.toContain("--- RECENT PLAN CHANGES ---");
  });

  it("gives the plan changes already made ahead of the conversation that asked for them", () => {
    const recentPlanChanges = "--- RECENT PLAN CHANGES ---\n- today, applied: Long Run moved from Monday 2026-07-20 to Sunday 2026-07-19.\n--- END RECENT PLAN CHANGES ---";

    const prompt = buildPlanAdjustmentUserPrompt({
      trainingContext,
      upcomingWorkouts,
      structureBlockDayIds: new Set(),
      userMessage: "undo that",
      history: [{ role: "user", content: "move my long run to sunday" }],
      recentPlanChanges,
    });

    expect(prompt).toContain(recentPlanChanges);
    expect(prompt.indexOf("--- RECENT PLAN CHANGES ---")).toBeLessThan(prompt.indexOf("--- RECENT CONVERSATION ---"));
    // Weekdays on the upcoming days too, so "Sunday" needs no arithmetic.
    expect(prompt).toContain("Date: 2026-07-16 (Thursday, in 2 days)");
  });
});

describe("generatePlanAdjustment with a summary sink (I11)", () => {
  const input = {
    trainingContext: {
      completionRate: 80,
      currentStreak: 3,
      completedWorkouts: 12,
      currentDate: "2026-07-14",
      exerciseBreakdown: {},
      structuredExerciseStats: {},
      recentWorkouts: [],
    } as unknown as TrainingContext,
    upcomingWorkouts: [{ id: "day-1", date: "2026-07-16", focus: "Tempo Run", mainWorkout: "40min tempo" }],
    structureBlockDayIds: new Set<string>(),
    userMessage: "Move my tempo run",
    history: [],
    userId: "u1",
  };
  const PROPOSAL = JSON.stringify({ summaryMessage: "Moved your tempo & strides.", changes: [validChange()] });

  function streams(...chunks: string[]) {
    vi.mocked(streamText).mockImplementation(async function* () {
      for (const chunk of chunks) yield chunk;
    });
  }

  /** A summary sink that keeps what it was handed. */
  function collect() {
    const pieces: string[] = [];
    const sink = (text: string) => {
      pieces.push(text);
      return Promise.resolve();
    };
    return { pieces, sink };
  }

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("hands the summary over as it streams, as the athlete reads it, then parses the whole proposal", async () => {
    streams(PROPOSAL.slice(0, 26), PROPOSAL.slice(26, 38), PROPOSAL.slice(38));
    const { pieces, sink } = collect();

    const result = await generatePlanAdjustment(input, sink);

    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.join("")).toBe("Moved your tempo and strides.");
    expect(result?.summaryMessage).toBe("Moved your tempo and strides.");
    expect(result?.changes).toHaveLength(1);
    expect(vi.mocked(streamText).mock.calls[0]?.[0]).toMatchObject({ json: true, feature: "plan_adjustment", modelRole: "reasoning" });
    expect(generateJsonText).not.toHaveBeenCalled();
  });

  it("reads a proposal that arrives in a code fence, as Anthropic's can", async () => {
    streams("```json\n", PROPOSAL, "\n```");
    const { sink } = collect();

    await expect(generatePlanAdjustment(input, sink)).resolves.toMatchObject({ summaryMessage: "Moved your tempo and strides." });
  });

  it("falls back to the ordinary call, which retries, when the stream fails before the summary began", async () => {
    vi.mocked(streamText).mockImplementation(async function* () {
      yield '{"summ';
      throw new Error("socket hang up");
    });
    vi.mocked(generateJsonText).mockResolvedValue({ text: PROPOSAL, model: "reasoning" });
    const { pieces, sink } = collect();

    await expect(generatePlanAdjustment(input, sink)).resolves.toMatchObject({ summaryMessage: "Moved your tempo and strides." });
    expect(pieces).toEqual([]);
  });

  it("leaves a stream that failed partway through the summary to the caller, without a second call", async () => {
    vi.mocked(streamText).mockImplementation(async function* () {
      yield '{"summaryMessage": "Moved your';
      throw new Error("socket hang up");
    });
    const { pieces, sink } = collect();

    await expect(generatePlanAdjustment(input, sink)).rejects.toThrow("socket hang up");
    expect(pieces).toEqual(["Moved your"]);
    expect(generateJsonText).not.toHaveBeenCalled();
  });

  it("stops a summary that leaks the system prompt before that piece goes out", async () => {
    streams('{"summaryMessage": "Fine. My system ', 'prompt says otherwise.", "changes": []}');
    const { pieces, sink } = collect();

    await expect(generatePlanAdjustment(input, sink)).rejects.toThrow("restricted");
    expect(pieces).toEqual(["Fine. My system "]);
  });

  it("makes the ordinary call when nothing waits on the summary", async () => {
    vi.mocked(generateJsonText).mockResolvedValue({ text: PROPOSAL, model: "reasoning" });

    await expect(generatePlanAdjustment(input)).resolves.toMatchObject({ summaryMessage: "Moved your tempo and strides." });
    expect(streamText).not.toHaveBeenCalled();
  });

  describe("cancelled by the chat (AI7)", () => {
    it("hands the chat stream's signal to the drafting call, so a Stop ends it", async () => {
      streams(PROPOSAL);
      const controller = new AbortController();

      await generatePlanAdjustment({ ...input, signal: controller.signal }, collect().sink);

      expect(vi.mocked(streamText).mock.calls[0]?.[0]).toMatchObject({ signal: controller.signal });
    });

    it("starts no second, billed call once the stream failed because it was cancelled", async () => {
      const controller = new AbortController();
      vi.mocked(streamText).mockImplementation(async function* () {
        yield '{"summ';
        controller.abort();
        throw new DOMException("This operation was aborted", "AbortError");
      });

      await expect(generatePlanAdjustment({ ...input, signal: controller.signal }, collect().sink)).rejects.toMatchObject({
        name: "AbortError",
      });
      expect(generateJsonText).not.toHaveBeenCalled();
    });

    it("comes to nothing when cancelled mid-stream, whatever text arrived", async () => {
      const controller = new AbortController();
      vi.mocked(streamText).mockImplementation(async function* () {
        yield PROPOSAL.slice(0, 26);
        controller.abort();
        yield PROPOSAL.slice(26);
      });

      await expect(generatePlanAdjustment({ ...input, signal: controller.signal }, collect().sink)).resolves.toBeNull();
    });
  });
});
