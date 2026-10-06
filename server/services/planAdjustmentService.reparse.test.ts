/**
 * Applying a proposal re-parses its table-backed days a few at a time, not one
 * after another: up to 14 serial AI parses could outlast the client's 90 s
 * timeout. Each day still gets its own rows, the parses still finish before the
 * apply's transaction opens (D45), and once one day fails the days still
 * queued are not parsed. PF14 (CODEBASE_ANALYSIS_2026-10-03).
 */
import type {
  EnrichedPlanAdjustmentChange,
  ExerciseSet,
  PlanAdjustmentProposal,
  PlanDay,
} from "@shared/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockPlanDay } from "../../test/factories";
import { storage } from "../storage";
import {
  buildWorkoutPrescriptionFingerprint,
  mapExerciseSetToPromptDetail,
} from "./aiModificationGuard";
import { applyPlanAdjustmentProposal } from "./planAdjustmentService";
import {
  applyStructuredPlanDaySuggestionRows,
  parseStructuredPlanDaySuggestionRows,
} from "./structuredPlanDaySuggestion";

const tx = vi.hoisted(() => ({
  // The exercise table read back after an apply rewrites it.
  select: vi.fn(() => ({ from: () => ({ where: () => Promise.resolve([]) }) })),
}));

vi.mock("../storage", () => ({
  storage: {
    users: { getUser: vi.fn() },
    workouts: { getExerciseSetsByPlanDays: vi.fn() },
    plans: { getPlanDaysByIds: vi.fn(), lockPlanDaysWithSets: vi.fn(), updatePlanDay: vi.fn() },
    planProposals: { getById: vi.fn(), resolve: vi.fn(), markApplied: vi.fn() },
  },
}));
vi.mock("../db", () => ({
  db: { transaction: vi.fn(<T>(fn: (client: unknown) => Promise<T>) => fn(tx)) },
}));
vi.mock("../logger", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock("../gemini/planAdjustmentService", () => ({ generatePlanAdjustment: vi.fn() }));
vi.mock("./aiContextService", () => ({ extractCoachingMaterialsText: vi.fn() }));
vi.mock("./aiSafety", () => ({ analyzeSafetySignals: vi.fn(), buildSafetyReviewNote: vi.fn() }));
vi.mock("./aiSuggestionService", () => ({
  getStructuredApplyBlocker: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("./recentPlanChanges", () => ({ loadRecentPlanChanges: vi.fn() }));
vi.mock("./trainingContextCache", () => ({ invalidateTrainingContext: vi.fn() }));
vi.mock("./structuredPlanDaySuggestion", () => ({
  parseStructuredPlanDaySuggestionRows: vi.fn(),
  applyStructuredPlanDaySuggestionRows: vi.fn(() => Promise.resolve()),
}));

const DAY_IDS = ["day-1", "day-2", "day-3", "day-4", "day-5"];

function setsFor(planDayId: string): ExerciseSet[] {
  const set = { id: `set-${planDayId}`, planDayId, exerciseName: "rowing", category: "functional" };
  return [{ ...set, setNumber: 1, sortOrder: 0 } as ExerciseSet];
}

function structuredChange(day: PlanDay): EnrichedPlanAdjustmentChange {
  const fingerprint = buildWorkoutPrescriptionFingerprint({
    mainWorkout: day.mainWorkout,
    exerciseDetails: setsFor(day.id).map((set) => mapExerciseSetToPromptDetail(set)),
  });
  return {
    planDayId: day.id,
    updatedFields: { mainWorkout: "Full Hyrox class session" },
    rationale: "Honors the class request.",
    kind: "workout_update",
    dayLabel: "Thu Jul 16 — Tempo Run",
    baseline: {
      focus: day.focus,
      mainWorkout: day.mainWorkout,
      accessory: day.accessory,
      notes: day.notes,
      scheduledDate: day.scheduledDate,
      expectedDurationMin: null,
      expectedRpe: null,
      status: "planned",
      fingerprint,
    },
    structured: true,
    hasStructureBlocks: false,
  };
}

function proposalRow(
  changes: EnrichedPlanAdjustmentChange[],
  status = "pending",
): PlanAdjustmentProposal {
  return {
    id: "prop-1",
    userId: "user-1",
    planId: "plan-1",
    status,
    summaryMessage: "Updated your week.",
    userRequest: "hyrox class please",
    payload: { changes },
    aiSource: null,
    createdAt: new Date(),
    resolvedAt: null,
    applyUndo: null,
    revertedAt: null,
  };
}

/** A pending proposal rewriting five table-backed days, with every read the apply makes mocked. */
function mockFiveStructuredDays(): void {
  const days = DAY_IDS.map((id) =>
    createMockPlanDay({
      id,
      planId: "plan-1",
      focus: "Tempo Run",
      mainWorkout: "40min tempo",
      scheduledDate: "2026-07-16",
    }),
  );
  const setsByDay = new Map(days.map((day) => [day.id, setsFor(day.id)]));
  vi.mocked(storage.planProposals.getById).mockResolvedValue(
    proposalRow(days.map(structuredChange)),
  );
  vi.mocked(storage.plans.getPlanDaysByIds).mockResolvedValue(days);
  vi.mocked(storage.workouts.getExerciseSetsByPlanDays).mockResolvedValue(setsByDay);
  vi.mocked(storage.plans.lockPlanDaysWithSets).mockResolvedValue({ days, setsByDay });
  vi.mocked(storage.users.getUser).mockResolvedValue({
    weightUnit: "kg",
    distanceUnit: "km",
  } as never);
  vi.mocked(storage.plans.updatePlanDay).mockImplementation((id, updates) => {
    const day = days.find((candidate) => candidate.id === id);
    return Promise.resolve(day ? { ...day, ...updates } : day);
  });
  vi.mocked(storage.planProposals.markApplied).mockResolvedValue(proposalRow([], "applied"));
}

/** Each parse takes a while, later days less than earlier ones, so they finish out of order. */
function parseSlowly(failingDayId?: string): { active: number; peak: number } {
  const flight = { active: 0, peak: 0 };
  vi.mocked(parseStructuredPlanDaySuggestionRows).mockImplementation(async ({ workoutId }) => {
    flight.active += 1;
    flight.peak = Math.max(flight.peak, flight.active);
    const delayMs =
      workoutId === failingDayId ? 0 : 2 * (DAY_IDS.length - DAY_IDS.indexOf(workoutId));
    await new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });
    flight.active -= 1;
    if (workoutId === failingDayId) throw new Error("parse failed");
    const exerciseName = `ski erg for ${workoutId}`;
    return [{ planDayId: workoutId, exerciseName, category: "functional", setNumber: 1 }];
  });
  return flight;
}

describe("applyPlanAdjustmentProposal re-parsing several table-backed days", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The days fall on Thu 16 Jul 2026; an apply turns away days already past (C33).
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-07-15T09:00:00Z") });
    mockFiveStructuredDays();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("parses three at a time and writes each day its own rows", async () => {
    const flight = parseSlowly();

    expect(await applyPlanAdjustmentProposal("user-1", "prop-1")).toEqual({
      applied: true,
      changeCount: 5,
    });

    expect(parseStructuredPlanDaySuggestionRows).toHaveBeenCalledTimes(5);
    expect(flight.peak).toBe(3);
    const written = vi.mocked(applyStructuredPlanDaySuggestionRows).mock.calls.map((call) => ({
      planDayId: call[0],
      exerciseName: call[2][0]?.exerciseName,
    }));
    expect(written).toEqual(
      DAY_IDS.map((planDayId) => ({ planDayId, exerciseName: `ski erg for ${planDayId}` })),
    );
    // Every parse ran before the transaction locked the days, none inside it (D45).
    const parseOrders = vi.mocked(parseStructuredPlanDaySuggestionRows).mock.invocationCallOrder;
    const [lockOrder] = vi.mocked(storage.plans.lockPlanDaysWithSets).mock.invocationCallOrder;
    expect(Math.max(...parseOrders)).toBeLessThan(lockOrder);
  });

  it("parses none of the days still queued once one fails, and writes nothing", async () => {
    parseSlowly("day-1");

    const result = await applyPlanAdjustmentProposal("user-1", "prop-1");

    expect(result).toMatchObject({ applied: false, reason: "structured_parse_failed" });
    // day-1 to day-3 were already running; day-4 and day-5 never call the AI.
    const parsedDays = vi
      .mocked(parseStructuredPlanDaySuggestionRows)
      .mock.calls.map((call) => call[0].workoutId);
    expect(parsedDays).toEqual(["day-1", "day-2", "day-3"]);
    expect(storage.plans.lockPlanDaysWithSets).not.toHaveBeenCalled();
    expect(storage.plans.updatePlanDay).not.toHaveBeenCalled();
    // Left pending, not invalidated: a retry may succeed.
    expect(storage.planProposals.resolve).not.toHaveBeenCalled();
  });
});
