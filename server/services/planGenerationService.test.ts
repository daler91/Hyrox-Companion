import type { GeneratePlanInput, PlanDay } from "@shared/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockPlanDay } from "../../test/factories";
import { ErrorCode } from "../errors";
import { buildGenerationPrompt, createPendingPlan, describeStartLoadPosture, executePlanGeneration } from "./planGenerationService";
import { summary } from "./trainingLoadGovernor.testHelpers";

const mocks = vi.hoisted(() => {
  const generateContent = vi.fn();
  const insertValues = vi.fn();
  const tx = {
    insert: vi.fn(() => ({ values: insertValues })),
  };
  const transaction = vi.fn(<T,>(fn: (tx: unknown) => Promise<T>) => fn(tx));
  return {
    generateContent,
    insertValues,
    tx,
    transaction,
    getAiClient: vi.fn(() => ({ models: { generateContent } })),
    retryWithBackoff: vi.fn((fn: () => Promise<unknown>) => fn()),
    trackUsageFromResponse: vi.fn(),
    plans: {
      createTrainingPlan: vi.fn(),
      createPlanDays: vi.fn(),
      schedulePlan: vi.fn(),
      updateGenerationStatus: vi.fn(),
    },
    users: {
      getUser: vi.fn(),
    },
    analytics: {
      getWorkoutLogsByDateRange: vi.fn(),
      getAllExerciseSetsWithDates: vi.fn(),
      getExerciseLoadTags: vi.fn(),
    },
  };
});

vi.mock("../db", () => ({
  db: {
    transaction: mocks.transaction,
  },
}));

vi.mock("../gemini/client", () => ({
  GEMINI_SUGGESTIONS_MODEL: "gemini-test-model",
  getAiClient: mocks.getAiClient,
  retryWithBackoff: mocks.retryWithBackoff,
  trackUsageFromResponse: mocks.trackUsageFromResponse,
}));

vi.mock("../logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../storage", () => ({
  storage: {
    plans: mocks.plans,
    users: mocks.users,
    analytics: mocks.analytics,
  },
}));

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
type DayName = (typeof DAY_NAMES)[number];

type GeneratedDayLike = {
  weekNumber: number;
  dayName: DayName;
  focus: string;
  mainWorkout: string;
  accessory: string | null;
  notes: string | null;
  exercises?: unknown[];
};

// A 7-day span → a 1-week plan; individual tests widen endDate for longer plans.
const baseInput: GeneratePlanInput = {
  goal: "Hyrox race prep",
  daysPerWeek: 2,
  experienceLevel: "intermediate",
  startDate: "2026-01-05",
  endDate: "2026-01-12",
  endDateIsRaceDate: true,
};

function makeExerciseDay(
  weekNumber: number,
  dayName: DayName = "Monday",
  overrides: Partial<GeneratedDayLike> = {},
): GeneratedDayLike {
  return {
    weekNumber,
    dayName,
    focus: "Strength",
    mainWorkout: "Back squat 2x5 at 100kg",
    accessory: null,
    notes: null,
    exercises: [
      {
        exerciseName: "back_squat",
        category: "strength",
        sets: [
          { setNumber: 1, reps: 5, weight: 100 },
        ],
      },
    ],
    ...overrides,
  };
}

function makeRestDay(
  weekNumber: number,
  dayName: DayName,
  overrides: Partial<GeneratedDayLike> = {},
): GeneratedDayLike {
  return {
    weekNumber,
    dayName,
    focus: "Rest",
    mainWorkout: "Complete rest",
    accessory: null,
    notes: null,
    exercises: [],
    ...overrides,
  };
}

function makeGeneratedWeek(
  weekNumber: number,
  exerciseOverrides: Partial<GeneratedDayLike> = {},
): GeneratedDayLike[] {
  return DAY_NAMES.map((dayName) =>
    dayName === "Monday"
      ? makeExerciseDay(weekNumber, dayName, exerciseOverrides)
      : makeRestDay(weekNumber, dayName),
  );
}

function makeGeneratedWeeks(startWeek: number, endWeek: number): GeneratedDayLike[] {
  return Array.from({ length: endWeek - startWeek + 1 }, (_, index) => startWeek + index)
    .flatMap((weekNumber) => makeGeneratedWeek(weekNumber));
}

function createPlanDaysFromGenerated(days: GeneratedDayLike[]): PlanDay[] {
  return days.map((day) =>
    createMockPlanDay({
      id: `day-${day.weekNumber}-${day.dayName}`,
      planId: "plan-1",
      weekNumber: day.weekNumber,
      dayName: day.dayName,
      focus: day.focus,
      mainWorkout: day.mainWorkout,
      accessory: day.accessory,
      notes: day.notes,
    }),
  );
}

function mockAiChunks(...chunks: GeneratedDayLike[][]): void {
  for (const days of chunks) {
    mocks.generateContent.mockResolvedValueOnce({ text: JSON.stringify(days) });
  }
}

function setupPlanStorage(_input: GeneratePlanInput, createdDays: PlanDay[]): void {
  mocks.plans.createPlanDays.mockResolvedValue(createdDays);
  mocks.plans.updateGenerationStatus.mockResolvedValue(undefined);
}

function getPromptText(call: unknown[]): string {
  const request = call[0] as { contents: Array<{ parts: Array<{ text: string }> }> };
  return request.contents[0].parts[0].text;
}

describe("describeStartLoadPosture", () => {
  it("calibrates down for danger / yellow / undertraining and stays silent otherwise", () => {
    expect(describeStartLoadPosture(summary([], { zone: "danger", acwr: 1.6 }))).toContain("conservatively");
    expect(describeStartLoadPosture(summary([], { zone: "yellow", acwr: 1.4 }))).toContain("Ease into week 1");
    expect(describeStartLoadPosture(summary([], { zone: "undertraining", acwr: 0.7 }))).toContain("Ramp volume gently");
    expect(describeStartLoadPosture(summary([], { zone: "sweet_spot", acwr: 1.0 }))).toBeNull();
    expect(describeStartLoadPosture(summary([], { zone: "insufficient_data", acwr: null }))).toBeNull();
  });

  it("embeds the ACWR value when known", () => {
    expect(describeStartLoadPosture(summary([], { zone: "danger", acwr: 1.62 }))).toContain("ACWR 1.62");
  });
});

describe("buildGenerationPrompt — start-load posture", () => {
  const input = { ...baseInput, totalWeeks: 4 } as Parameters<typeof buildGenerationPrompt>[0];
  const units = { weightUnit: "kg", distanceUnit: "km" } as Parameters<typeof buildGenerationPrompt>[2];
  const posture = "Carrying high recent load (ACWR 1.60); start week 1 conservatively.";

  it("injects the posture into the opening (week 1) chunk", () => {
    const prompt = buildGenerationPrompt(input, { startWeek: 1, endWeek: 2 }, units, posture);
    expect(prompt).toContain("CURRENT LOAD POSTURE:");
    expect(prompt).toContain(posture);
  });

  it("omits the posture from later chunks", () => {
    const prompt = buildGenerationPrompt(input, { startWeek: 3, endWeek: 4 }, units, posture);
    expect(prompt).not.toContain("CURRENT LOAD POSTURE");
  });

  it("omits the section when there is no posture", () => {
    const prompt = buildGenerationPrompt(input, { startWeek: 1, endWeek: 2 }, units, null);
    expect(prompt).not.toContain("CURRENT LOAD POSTURE");
  });
});

describe("executePlanGeneration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insertValues.mockResolvedValue(undefined);
    mocks.tx.insert.mockReturnValue({ values: mocks.insertValues });
    mocks.transaction.mockImplementation(<T,>(fn: (tx: unknown) => Promise<T>) => fn(mocks.tx));
    mocks.getAiClient.mockReturnValue({ models: { generateContent: mocks.generateContent } });
    mocks.retryWithBackoff.mockImplementation((fn: () => Promise<unknown>) => fn());
    mocks.trackUsageFromResponse.mockReturnValue(undefined);
    mocks.plans.schedulePlan.mockResolvedValue(true);
    mocks.plans.updateGenerationStatus.mockResolvedValue(undefined);
    mocks.users.getUser.mockResolvedValue({ weightUnit: "kg", distanceUnit: "km" });
    mocks.analytics.getWorkoutLogsByDateRange.mockResolvedValue([]);
    mocks.analytics.getAllExerciseSetsWithDates.mockResolvedValue([]);
    mocks.analytics.getExerciseLoadTags.mockResolvedValue([]);
  });

  it("splits an 8-week request into four two-week chunks and persists days in order", async () => {
    const input = { ...baseInput, endDate: "2026-03-02" } as const; // 56-day span → 8 weeks
    const sortedDays = makeGeneratedWeeks(1, 8);
    setupPlanStorage(input, createPlanDaysFromGenerated(sortedDays));
    mockAiChunks(
      [...makeGeneratedWeek(2), ...makeGeneratedWeek(1)],
      [...makeGeneratedWeek(4), ...makeGeneratedWeek(3)],
      [...makeGeneratedWeek(6), ...makeGeneratedWeek(5)],
      [...makeGeneratedWeek(8), ...makeGeneratedWeek(7)],
    );

    await executePlanGeneration("plan-1", input, "user-1");

    expect(mocks.generateContent).toHaveBeenCalledTimes(4);
    expect(mocks.retryWithBackoff.mock.calls.map((call) => call[1])).toEqual([
      "planGeneration:w1-2",
      "planGeneration:w3-4",
      "planGeneration:w5-6",
      "planGeneration:w7-8",
    ]);
    expect(mocks.generateContent.mock.calls.map(getPromptText).map((text) => text.match(/weeks? \d(?:-\d)?/)?.[0])).toEqual([
      "weeks 1-2",
      "weeks 3-4",
      "weeks 5-6",
      "weeks 7-8",
    ]);
    expect(mocks.plans.createPlanDays.mock.calls[0][0].map((day: PlanDay) => `${day.weekNumber}-${day.dayName}`)).toEqual(
      sortedDays.map((day) => `${day.weekNumber}-${day.dayName}`),
    );
  });

  it("persists generated plan notes and plan-day exercise rows", async () => {
    const generatedDays = makeGeneratedWeek(1, {
      notes: "Keep bracing tight",
      exercises: [
        {
          exerciseName: "back_squat",
          category: "strength",
          sets: [
            { setNumber: 1, reps: 5, weight: 100, notes: "Smooth and controlled" },
            { setNumber: 2, reps: 5, weight: 100, notes: "No grind reps" },
          ],
        },
      ],
    });
    generatedDays[1] = makeRestDay(1, "Tuesday", { notes: "Light walk only" });
    setupPlanStorage(baseInput, createPlanDaysFromGenerated(generatedDays));
    mockAiChunks(generatedDays);

    await executePlanGeneration("plan-1", baseInput, "user-1");

    expect(mocks.plans.createPlanDays).toHaveBeenCalledWith([
      expect.objectContaining({ dayName: "Monday", notes: "Keep bracing tight", aiSource: "generated" }),
      expect.objectContaining({ dayName: "Tuesday", notes: "Light walk only", aiSource: "generated" }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    ], mocks.tx);
    expect(mocks.insertValues).toHaveBeenCalledWith([
      expect.objectContaining({
        planDayId: "day-1-Monday",
        workoutLogId: null,
        exerciseName: "back_squat",
        reps: 5,
        weight: 100,
        notes: "Smooth and controlled",
        sortOrder: 0,
      }),
      expect.objectContaining({
        planDayId: "day-1-Monday",
        workoutLogId: null,
        exerciseName: "back_squat",
        reps: 5,
        weight: 100,
        notes: "No grind reps",
        sortOrder: 1,
      }),
    ]);
  });

  it("normalizes AI-generated text and structured rows to the user's units", async () => {
    mocks.users.getUser.mockResolvedValue({ weightUnit: "lbs", distanceUnit: "miles" });
    const generatedDays = makeGeneratedWeek(1, {
      mainWorkout: "Back squat 1x5 at 75kg then run 5km",
      exercises: [
        {
          exerciseName: "back_squat",
          category: "strength",
          sets: [
            { setNumber: 1, reps: 5, weight: 75, weightUnit: "kg" },
          ],
        },
        {
          exerciseName: "easy_run",
          category: "running",
          sets: [
            { setNumber: 1, distance: 5, distanceUnit: "km", time: 30 },
          ],
        },
      ],
    });
    setupPlanStorage(baseInput, createPlanDaysFromGenerated(generatedDays));
    mockAiChunks(generatedDays);

    await executePlanGeneration("plan-1", baseInput, "user-1");

    expect(getPromptText(mocks.generateContent.mock.calls[0])).toContain("Weight: lbs");
    expect(getPromptText(mocks.generateContent.mock.calls[0])).toContain("Distance preference: miles");
    expect(mocks.plans.createPlanDays).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          dayName: "Monday",
          mainWorkout: "Back squat 1x5 at 165 lbs then run 5000 m",
        }),
      ]),
      mocks.tx,
    );
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ exerciseName: "back_squat", weight: 165 }),
        expect.objectContaining({ exerciseName: "easy_run", distance: 16404 }),
      ]),
    );
  });

  it("accepts rest days with empty exercise arrays", async () => {
    const generatedDays = DAY_NAMES.map((dayName) => makeRestDay(1, dayName, { notes: dayName === "Sunday" ? "Hydrate" : null }));
    setupPlanStorage(baseInput, createPlanDaysFromGenerated(generatedDays));
    mockAiChunks(generatedDays);

    await executePlanGeneration("plan-1", baseInput, "user-1");

    expect(mocks.tx.insert).not.toHaveBeenCalled();
    expect(mocks.plans.createPlanDays).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ dayName: "Sunday", notes: "Hydrate" })]),
      mocks.tx,
    );
    expect(mocks.plans.updateGenerationStatus).toHaveBeenCalledWith("plan-1", "ready");
  });

  it("rejects incomplete chunk coverage and marks plan failed", async () => {
    const input = { ...baseInput, endDate: "2026-01-19" } as const; // 14-day span → 2 weeks
    mockAiChunks(makeGeneratedWeek(1));

    await expect(executePlanGeneration("plan-1", input, "user-1")).rejects.toMatchObject({
      code: ErrorCode.AI_ERROR,
      status: 502,
    });

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.plans.updateGenerationStatus).toHaveBeenCalledWith("plan-1", "failed", expect.any(String));
  });

  it("rejects non-rest days missing exercise-table rows and marks plan failed", async () => {
    const generatedDays = makeGeneratedWeek(1, { exercises: undefined });
    mockAiChunks(generatedDays);

    await expect(executePlanGeneration("plan-1", baseInput, "user-1")).rejects.toMatchObject({
      code: ErrorCode.AI_ERROR,
      status: 502,
    });

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.plans.updateGenerationStatus).toHaveBeenCalledWith("plan-1", "failed", expect.any(String));
  });

  it("rejects non-rest days when all generated exercise rows are invalid and marks plan failed", async () => {
    const generatedDays = makeGeneratedWeek(1, {
      exercises: [
        { exerciseName: "back_squat", category: "strength", sets: [] },
      ],
    });
    mockAiChunks(generatedDays);

    await expect(executePlanGeneration("plan-1", baseInput, "user-1")).rejects.toMatchObject({
      code: ErrorCode.AI_ERROR,
      status: 502,
    });

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.plans.updateGenerationStatus).toHaveBeenCalledWith("plan-1", "failed", expect.any(String));
  });

  it("does not commit plan days when a chunk provider call times out", async () => {
    mocks.generateContent.mockRejectedValue(new Error("AI call timed out after 90000ms (planGeneration:w1-1)"));

    await expect(executePlanGeneration("plan-1", baseInput, "user-1")).rejects.toThrow("timed out");

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.plans.updateGenerationStatus).toHaveBeenCalledWith("plan-1", "failed", expect.stringContaining("timed out"));
  });

  it("schedules the generated plan from the provided start date", async () => {
    const generatedDays = makeGeneratedWeek(1);
    setupPlanStorage(baseInput, createPlanDaysFromGenerated(generatedDays));
    mockAiChunks(generatedDays);

    await executePlanGeneration("plan-1", baseInput, "user-1");

    expect(mocks.plans.schedulePlan).toHaveBeenCalledWith("plan-1", "2026-01-05", "user-1");
  });

  it("includes the race-date prompt line when the end date is the race date", async () => {
    const generatedDays = makeGeneratedWeek(1);
    setupPlanStorage(baseInput, createPlanDaysFromGenerated(generatedDays));
    mockAiChunks(generatedDays);

    await executePlanGeneration("plan-1", baseInput, "user-1");

    const prompt = getPromptText(mocks.generateContent.mock.calls[0]);
    expect(prompt).toContain("Race Date: 2026-01-12");
    // Nudges the model to taper the final days into the race.
    expect(prompt).toContain("shakeout");
  });

  it("omits the race-date prompt line when the end date is not the race date", async () => {
    const input = { ...baseInput, endDateIsRaceDate: false };
    const generatedDays = makeGeneratedWeek(1);
    setupPlanStorage(input, createPlanDaysFromGenerated(generatedDays));
    mockAiChunks(generatedDays);

    await executePlanGeneration("plan-1", input, "user-1");

    expect(getPromptText(mocks.generateContent.mock.calls[0])).not.toContain("Race Date");
  });

  it("still generates from a legacy queued payload (totalWeeks/raceDate)", async () => {
    // Simulates an in-flight job enqueued before the start/end-date rename: the
    // normalizer falls back to the old totalWeeks/raceDate fields.
    const legacyInput = {
      goal: "Hyrox race prep",
      totalWeeks: 8,
      daysPerWeek: 2,
      experienceLevel: "intermediate",
      raceDate: "2026-03-02",
    } as unknown as GeneratePlanInput;
    setupPlanStorage(legacyInput, createPlanDaysFromGenerated(makeGeneratedWeeks(1, 8)));
    mockAiChunks(
      [...makeGeneratedWeek(2), ...makeGeneratedWeek(1)],
      [...makeGeneratedWeek(4), ...makeGeneratedWeek(3)],
      [...makeGeneratedWeek(6), ...makeGeneratedWeek(5)],
      [...makeGeneratedWeek(8), ...makeGeneratedWeek(7)],
    );

    await executePlanGeneration("plan-1", legacyInput, "user-1");

    expect(mocks.generateContent).toHaveBeenCalledTimes(4);
    expect(getPromptText(mocks.generateContent.mock.calls[0])).toContain("Race Date: 2026-03-02");
  });
});

describe("createPendingPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.plans.createTrainingPlan.mockResolvedValue({ id: "plan-1", name: "AI Plan: x", totalWeeks: 1 });
  });

  it("persists the race date when the end date is the athlete's race date", async () => {
    await createPendingPlan(baseInput, "user-1");

    expect(mocks.plans.createTrainingPlan).toHaveBeenCalledWith(
      expect.objectContaining({ raceDate: baseInput.endDate, totalWeeks: 1, goal: baseInput.goal }),
    );
  });

  it("stores a null race date when the end date is not the race date", async () => {
    await createPendingPlan({ ...baseInput, endDateIsRaceDate: false }, "user-1");

    expect(mocks.plans.createTrainingPlan).toHaveBeenCalledWith(
      expect.objectContaining({ raceDate: null }),
    );
  });
});
