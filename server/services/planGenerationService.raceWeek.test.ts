/**
 * A race-dated plan reaches its race, and the race day the prompt calls "the
 * event" does not fail the generation for having no exercise rows.
 * C19 and D15 (CODEBASE_ANALYSIS_2026-10-03).
 */
import type { GeneratePlanInput } from "@shared/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockPlanDay } from "../../test/factories";
import { ErrorCode } from "../errors";
import { createPendingPlan, executePlanGeneration } from "./planGenerationService";

const mocks = vi.hoisted(() => {
  const insertValues = vi.fn();
  const tx = { insert: vi.fn(() => ({ values: insertValues })) };
  return {
    generateJsonText: vi.fn(),
    insertValues,
    tx,
    transaction: vi.fn(<T,>(fn: (tx: unknown) => Promise<T>) => fn(tx)),
    plans: {
      createTrainingPlan: vi.fn(),
      createPlanDays: vi.fn(),
      schedulePlan: vi.fn(),
      updateGenerationStatus: vi.fn(),
      updateEngineState: vi.fn(),
      retirePlans: vi.fn(),
    },
    users: { getUser: vi.fn() },
    analytics: {
      getWorkoutLogsByDateRange: vi.fn(),
      getAllExerciseSetsWithDates: vi.fn(),
      getExerciseLoadTags: vi.fn(),
    },
    timelineAnnotations: { list: vi.fn() },
    athleteFacts: { list: vi.fn() },
  };
});

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

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

interface Day {
  weekNumber: number;
  dayName: string;
  focus: string;
  mainWorkout: string;
  accessory: null;
  notes: null;
  exercises: unknown[];
}

function day(weekNumber: number, dayName: string, overrides: Partial<Day> = {}): Day {
  const training = dayName === "Monday";
  return {
    weekNumber,
    dayName,
    focus: training ? "Strength" : "Rest",
    mainWorkout: training ? "A) Back Squat 3x5 @ 100 kg" : "Complete rest",
    accessory: null,
    notes: null,
    exercises: training
      ? [
          {
            exerciseName: "back_squat",
            category: "strength",
            sets: [{ setNumber: 1, reps: 5, weight: 100, weightUnit: "kg" }],
          },
        ]
      : [],
    ...overrides,
  };
}

/** Two weeks, with `overrides` laid over the named days. */
function twoWeeks(overrides: Record<string, Partial<Day>>): Day[] {
  const byDay = new Map(Object.entries(overrides));
  return [1, 2].flatMap((week) =>
    DAY_NAMES.map((dayName) => day(week, dayName, byDay.get(`${String(week)} ${dayName}`))),
  );
}

const RACE_DAY: Partial<Day> = {
  focus: "HYROX Race Day",
  mainWorkout: "Race: 8 x 1 km run with the 8 stations",
  exercises: [],
};

// Monday 5 January to a Thursday race in the second week.
const thursdayRace: GeneratePlanInput = {
  goal: "Hyrox race prep",
  daysPerWeek: 2,
  experienceLevel: "intermediate",
  startDate: "2026-01-05",
  endDate: "2026-01-15",
  endDateIsRaceDate: true,
};

function mockGeneration(days: Day[]): void {
  mocks.generateJsonText.mockResolvedValueOnce({ text: JSON.stringify(days) });
  mocks.plans.createPlanDays.mockResolvedValue(
    days.map((entry) =>
      createMockPlanDay({
        id: `day-${String(entry.weekNumber)}-${entry.dayName}`,
        weekNumber: entry.weekNumber,
        dayName: entry.dayName,
      }),
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.insertValues.mockResolvedValue(undefined);
  mocks.tx.insert.mockReturnValue({ values: mocks.insertValues });
  mocks.transaction.mockImplementation(<T,>(fn: (tx: unknown) => Promise<T>) => fn(mocks.tx));
  mocks.plans.createTrainingPlan.mockResolvedValue({ id: "plan-1", name: "AI Plan", totalWeeks: 2 });
  mocks.plans.schedulePlan.mockResolvedValue("scheduled");
  mocks.plans.updateGenerationStatus.mockResolvedValue(undefined);
  mocks.plans.retirePlans.mockResolvedValue([]);
  mocks.users.getUser.mockResolvedValue({ weightUnit: "kg", distanceUnit: "km" });
  mocks.analytics.getWorkoutLogsByDateRange.mockResolvedValue([]);
  mocks.analytics.getAllExerciseSetsWithDates.mockResolvedValue([]);
  mocks.analytics.getExerciseLoadTags.mockResolvedValue([]);
  mocks.timelineAnnotations.list.mockResolvedValue([]);
  mocks.athleteFacts.list.mockResolvedValue([]);
});

describe("a race-dated plan's length (C19)", () => {
  it("runs through the week that holds a Monday-to-Thursday race", async () => {
    await createPendingPlan(thursdayRace, "user-1");

    // Rounded, the 10-day span was one week and the race fell after the plan.
    expect(mocks.plans.createTrainingPlan).toHaveBeenCalledWith(
      expect.objectContaining({ totalWeeks: 2, raceDate: "2026-01-15" }),
    );
  });

  it("covers race week after a midweek start", async () => {
    await createPendingPlan(
      { ...thursdayRace, startDate: "2026-10-07", endDate: "2026-11-28" },
      "user-1",
    );

    expect(mocks.plans.createTrainingPlan).toHaveBeenCalledWith(
      expect.objectContaining({ totalWeeks: 8 }),
    );
  });

  it("generates race week, so the race is a day of the plan", async () => {
    mockGeneration(twoWeeks({ "2 Thursday": RACE_DAY }));

    await executePlanGeneration("plan-1", thursdayRace, "user-1");

    expect(mocks.generateJsonText).toHaveBeenCalledTimes(1);
    expect(mocks.generateJsonText.mock.calls[0][0]).toMatchObject({
      label: "planGeneration:w1-2",
    });
  });
});

describe("race day without exercise rows (D15)", () => {
  it("accepts the race day itself and saves the plan", async () => {
    mockGeneration(twoWeeks({ "2 Thursday": RACE_DAY }));

    await executePlanGeneration("plan-1", thursdayRace, "user-1");

    expect(mocks.plans.createPlanDays).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ weekNumber: 2, dayName: "Thursday", focus: "HYROX Race Day" }),
      ]),
      mocks.tx,
    );
    expect(mocks.plans.updateGenerationStatus).toHaveBeenCalledWith(
      "plan-1",
      "ready",
      null,
      mocks.tx,
    );
  });

  it("still rejects any other training day that has no rows", async () => {
    mockGeneration(
      twoWeeks({
        "2 Tuesday": { focus: "Openers", mainWorkout: "4 x 1 min at race effort", exercises: [] },
        "2 Thursday": RACE_DAY,
      }),
    );

    await expect(executePlanGeneration("plan-1", thursdayRace, "user-1")).rejects.toMatchObject({
      code: ErrorCode.AI_ERROR,
      status: 502,
      details: { missingExerciseDays: ["2 Tuesday"] },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("exempts nothing when the end date is not a race", async () => {
    mockGeneration(twoWeeks({ "2 Thursday": RACE_DAY }));

    await expect(
      executePlanGeneration(
        "plan-1",
        { ...thursdayRace, endDate: "2026-01-18", endDateIsRaceDate: false },
        "user-1",
      ),
    ).rejects.toMatchObject({ details: { missingExerciseDays: ["2 Thursday"] } });
  });
});
