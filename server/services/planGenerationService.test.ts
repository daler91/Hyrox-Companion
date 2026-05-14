import type { PlanDay } from "@shared/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockPlanDay, createMockTrainingPlan, createMockTrainingPlanWithDays } from "../../test/factories";
import { ErrorCode } from "../errors";
import { generatePlan } from "./planGenerationService";

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
      getTrainingPlan: vi.fn(),
      schedulePlan: vi.fn(),
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
  },
}));

const baseInput = {
  goal: "Hyrox race prep",
  totalWeeks: 1,
  daysPerWeek: 2,
  experienceLevel: "intermediate",
} as const;

function mockAiDays(days: unknown[]): void {
  mocks.generateContent.mockResolvedValue({ text: JSON.stringify(days) });
}

function setupPlanStorage(createdDays: PlanDay[]): void {
  const plan = createMockTrainingPlan({ id: "plan-1", userId: "user-1", goal: baseInput.goal, totalWeeks: 1 });
  mocks.plans.createTrainingPlan.mockResolvedValue(plan);
  mocks.plans.createPlanDays.mockResolvedValue(createdDays);
  mocks.plans.getTrainingPlan.mockResolvedValue(
    createMockTrainingPlanWithDays({ id: "plan-1", userId: "user-1", days: createdDays }),
  );
}

describe("generatePlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insertValues.mockResolvedValue(undefined);
    mocks.tx.insert.mockReturnValue({ values: mocks.insertValues });
    mocks.transaction.mockImplementation(<T,>(fn: (tx: unknown) => Promise<T>) => fn(mocks.tx));
    mocks.getAiClient.mockReturnValue({ models: { generateContent: mocks.generateContent } });
    mocks.retryWithBackoff.mockImplementation((fn: () => Promise<unknown>) => fn());
    mocks.trackUsageFromResponse.mockReturnValue(undefined);
    mocks.plans.schedulePlan.mockResolvedValue(true);
  });

  it("persists generated plan notes and plan-day exercise rows", async () => {
    const createdDays = [
      createMockPlanDay({ id: "day-1", planId: "plan-1", dayName: "Monday", focus: "Strength" }),
      createMockPlanDay({ id: "day-2", planId: "plan-1", dayName: "Tuesday", focus: "Rest", mainWorkout: "Complete rest" }),
    ];
    setupPlanStorage(createdDays);
    mockAiDays([
      {
        weekNumber: 1,
        dayName: "Monday",
        focus: "Strength",
        mainWorkout: "Back squat 2x5 at 100kg",
        accessory: null,
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
      },
      {
        weekNumber: 1,
        dayName: "Tuesday",
        focus: "Rest",
        mainWorkout: "Complete rest",
        accessory: null,
        notes: "Light walk only",
        exercises: [],
      },
    ]);

    await generatePlan(baseInput, "user-1");

    expect(mocks.plans.createPlanDays).toHaveBeenCalledWith([
      expect.objectContaining({ dayName: "Monday", notes: "Keep bracing tight", aiSource: "generated" }),
      expect.objectContaining({ dayName: "Tuesday", notes: "Light walk only", aiSource: "generated" }),
    ], mocks.tx);
    expect(mocks.insertValues).toHaveBeenCalledWith([
      expect.objectContaining({
        planDayId: "day-1",
        workoutLogId: null,
        exerciseName: "back_squat",
        reps: 5,
        weight: 100,
        notes: "Smooth and controlled",
        sortOrder: 0,
      }),
      expect.objectContaining({
        planDayId: "day-1",
        workoutLogId: null,
        exerciseName: "back_squat",
        reps: 5,
        weight: 100,
        notes: "No grind reps",
        sortOrder: 1,
      }),
    ]);
  });

  it("accepts rest days with empty exercise arrays", async () => {
    const createdDays = [
      createMockPlanDay({ id: "day-rest", planId: "plan-1", dayName: "Sunday", focus: "Rest", mainWorkout: "Complete rest" }),
    ];
    setupPlanStorage(createdDays);
    mockAiDays([
      {
        weekNumber: 1,
        dayName: "Sunday",
        focus: "Rest",
        mainWorkout: "Complete rest",
        accessory: null,
        notes: "Hydrate",
        exercises: [],
      },
    ]);

    await expect(generatePlan(baseInput, "user-1")).resolves.toEqual(
      expect.objectContaining({ id: "plan-1" }),
    );

    expect(mocks.tx.insert).not.toHaveBeenCalled();
    expect(mocks.plans.createPlanDays).toHaveBeenCalledWith([
      expect.objectContaining({ dayName: "Sunday", notes: "Hydrate" }),
    ], mocks.tx);
  });

  it("rejects non-rest days missing exercise-table rows before creating a plan", async () => {
    mockAiDays([
      {
        weekNumber: 1,
        dayName: "Monday",
        focus: "Strength",
        mainWorkout: "Back squat 3x5",
        accessory: null,
        notes: null,
      },
    ]);

    await expect(generatePlan(baseInput, "user-1")).rejects.toMatchObject({
      code: ErrorCode.AI_ERROR,
      status: 502,
    });

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.plans.createTrainingPlan).not.toHaveBeenCalled();
  });

  it("rejects non-rest days when all generated exercise rows are invalid", async () => {
    mockAiDays([
      {
        weekNumber: 1,
        dayName: "Monday",
        focus: "Strength",
        mainWorkout: "Back squat 3x5",
        accessory: null,
        notes: null,
        exercises: [
          { exerciseName: "back_squat", category: "strength", sets: [] },
        ],
      },
    ]);

    await expect(generatePlan(baseInput, "user-1")).rejects.toMatchObject({
      code: ErrorCode.AI_ERROR,
      status: 502,
    });

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.plans.createTrainingPlan).not.toHaveBeenCalled();
  });
});
