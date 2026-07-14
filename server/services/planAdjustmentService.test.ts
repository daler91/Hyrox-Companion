import type { EnrichedPlanAdjustmentChange, PlanAdjustmentProposal } from "@shared/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { generatePlanAdjustment } from "../gemini/planAdjustmentService";
import { storage } from "../storage";
import type { AIContext } from "./aiContextService";
import {
  buildWorkoutPrescriptionFingerprint,
  mapExerciseSetToPromptDetail,
} from "./aiModificationGuard";
import { analyzeSafetySignals } from "./aiSafety";
import { getStructuredApplyBlocker } from "./aiSuggestionService";
import {
  applyPlanAdjustmentProposal,
  createPlanAdjustmentProposal,
  derivePlanAdjustmentChangeKind,
} from "./planAdjustmentService";
import { parseStructuredPlanDaySuggestionRows } from "./structuredPlanDaySuggestion";

const dbMockState = vi.hoisted(() => {
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const tx = {
    delete: vi.fn(() => ({ where: deleteWhere })),
  };
  return { deleteWhere, tx };
});

vi.mock("../storage", () => ({
  storage: {
    users: { getUser: vi.fn() },
    workouts: { getExerciseSetsByPlanDay: vi.fn() },
    plans: { getPlanDay: vi.fn(), updatePlanDay: vi.fn() },
    timeline: { getUpcomingPlannedDays: vi.fn() },
    planProposals: { create: vi.fn(), getById: vi.fn(), getPending: vi.fn(), resolve: vi.fn() },
  },
}));

vi.mock("../db", () => ({
  db: {
    transaction: vi.fn(<T,>(fn: (tx: unknown) => Promise<T>) => fn(dbMockState.tx as unknown)),
  },
}));

vi.mock("../gemini/planAdjustmentService", () => ({
  generatePlanAdjustment: vi.fn(),
}));

vi.mock("./aiContextService", () => ({
  extractCoachingMaterialsText: vi.fn().mockReturnValue(undefined),
}));

vi.mock("./aiSafety", () => ({
  analyzeSafetySignals: vi.fn().mockReturnValue({ redFlagDetected: false, hrMedicationDetected: false }),
  buildSafetyReviewNote: vi.fn().mockReturnValue("Please see a professional before training."),
}));

vi.mock("./aiSuggestionService", () => ({
  getStructuredApplyBlocker: vi.fn().mockResolvedValue(null),
}));

vi.mock("./structuredPlanDaySuggestion", () => ({
  parseStructuredPlanDaySuggestionRows: vi.fn(),
  applyStructuredPlanDaySuggestionRows: vi.fn().mockResolvedValue(undefined),
}));

const aiContext = {
  trainingContext: { activePlan: { goal: "First HYROX under 90min" } },
  ragInfo: { source: "none", chunkCount: 0 },
} as unknown as AIContext;

function upcomingDay(overrides: Record<string, unknown> = {}) {
  return {
    planDayId: "day-1",
    date: "2026-07-16",
    focus: "Tempo Run",
    mainWorkout: "40min tempo",
    accessory: null,
    notes: null,
    aiSource: null,
    aiRationale: null,
    aiNoteUpdatedAt: null,
    aiInputsUsed: null,
    expectedDurationMin: null,
    expectedRpe: null,
    exerciseSets: [],
    structureBlocks: [],
    ...overrides,
  };
}

function planDayRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "day-1",
    planId: "plan-1",
    weekNumber: 1,
    dayName: "Thursday",
    focus: "Tempo Run",
    mainWorkout: "40min tempo",
    accessory: null,
    notes: null,
    scheduledDate: "2026-07-16",
    status: "planned",
    aiSource: null,
    aiRationale: null,
    aiNoteUpdatedAt: null,
    aiInputsUsed: null,
    expectedDurationMin: null,
    expectedRpe: null,
    plannedTimeOfDayMin: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(analyzeSafetySignals).mockReturnValue({
    redFlagDetected: false,
    hrMedicationDetected: false,
  });
  vi.mocked(getStructuredApplyBlocker).mockResolvedValue(null);
  vi.mocked(storage.planProposals.create).mockImplementation(async (row) => ({
    id: "prop-1",
    status: "pending",
    createdAt: new Date(),
    resolvedAt: null,
    ...row,
  }) as PlanAdjustmentProposal);
});

describe("derivePlanAdjustmentChangeKind", () => {
  it("classifies prescription rewrites as workout_update", () => {
    expect(derivePlanAdjustmentChangeKind({ mainWorkout: "Hyrox class" })).toBe("workout_update");
  });

  it("classifies rest-like rewrites as rest_conversion", () => {
    expect(
      derivePlanAdjustmentChangeKind({ focus: "Rest", mainWorkout: "Complete rest or light walk" }),
    ).toBe("rest_conversion");
  });

  it("classifies date-only moves as reschedule", () => {
    expect(derivePlanAdjustmentChangeKind({ scheduledDate: "2026-07-18" })).toBe("reschedule");
  });

  it("classifies notes/expected-only edits as tune", () => {
    expect(derivePlanAdjustmentChangeKind({ notes: "Keep it easy", expectedRpe: 5 })).toBe("tune");
  });
});

describe("createPlanAdjustmentProposal", () => {
  const input = {
    userId: "user-1",
    message: "I want to go to a hyrox class on Thursday",
    history: [],
    aiContext,
  };

  it("falls back to chat when there are no upcoming planned days", async () => {
    vi.mocked(storage.timeline.getUpcomingPlannedDays).mockResolvedValue([]);

    const result = await createPlanAdjustmentProposal(input);

    expect(result.kind).toBe("chat_fallback");
    expect(generatePlanAdjustment).not.toHaveBeenCalled();
  });

  it("falls back with the safety note on a red flag, without generating", async () => {
    vi.mocked(storage.timeline.getUpcomingPlannedDays).mockResolvedValue([upcomingDay()] as never);
    vi.mocked(analyzeSafetySignals).mockReturnValue({
      redFlagDetected: true,
      hrMedicationDetected: false,
    });

    const result = await createPlanAdjustmentProposal(input);

    expect(result).toEqual({
      kind: "chat_fallback",
      text: "Please see a professional before training.",
    });
    expect(generatePlanAdjustment).not.toHaveBeenCalled();
  });

  it("clamps hallucinated day IDs and strips prescription edits on structure-block days", async () => {
    vi.mocked(storage.timeline.getUpcomingPlannedDays).mockResolvedValue([
      upcomingDay(),
      upcomingDay({ planDayId: "day-2", focus: "EMOM", structureBlocks: [{ id: "blk-1" }] }),
    ] as never);
    vi.mocked(generatePlanAdjustment).mockResolvedValue({
      summaryMessage: "Updated your week.",
      changes: [
        {
          planDayId: "day-1",
          updatedFields: { focus: "Hyrox Class", mainWorkout: "Full Hyrox class session" },
          rationale: "Honors the class request.",
        },
        {
          planDayId: "day-2",
          updatedFields: { mainWorkout: "should be stripped", notes: "Take it easy after the class" },
          rationale: "Recovery after the class.",
        },
        {
          planDayId: "day-hallucinated",
          updatedFields: { mainWorkout: "nonsense" },
          rationale: "Invented day.",
        },
      ],
    });
    vi.mocked(storage.plans.getPlanDay).mockImplementation(async (dayId: string) =>
      planDayRow({ id: dayId }),
    );
    vi.mocked(storage.workouts.getExerciseSetsByPlanDay).mockResolvedValue([]);

    const result = await createPlanAdjustmentProposal(input);

    expect(result.kind).toBe("proposal");
    const created = vi.mocked(storage.planProposals.create).mock.calls[0][0];
    expect(created.planId).toBe("plan-1");
    expect(created.userRequest).toBe(input.message);
    const changes = created.payload.changes;
    expect(changes.map((c: EnrichedPlanAdjustmentChange) => c.planDayId)).toEqual([
      "day-1",
      "day-2",
    ]);
    expect(changes[0].kind).toBe("workout_update");
    expect(changes[0].baseline.fingerprint).toBeTruthy();
    // Structure-block day keeps only the notes edit.
    expect(changes[1].updatedFields.mainWorkout).toBeUndefined();
    expect(changes[1].updatedFields.notes).toBe("Take it easy after the class");
    expect(changes[1].kind).toBe("tune");
    expect(changes[1].hasStructureBlocks).toBe(true);
  });

  it("falls back to the summary when the coach proposes no changes", async () => {
    vi.mocked(storage.timeline.getUpcomingPlannedDays).mockResolvedValue([upcomingDay()] as never);
    vi.mocked(generatePlanAdjustment).mockResolvedValue({
      summaryMessage: "Which day did you mean?",
      changes: [],
    });

    const result = await createPlanAdjustmentProposal(input);

    expect(result).toEqual({ kind: "chat_fallback", text: "Which day did you mean?" });
    expect(storage.planProposals.create).not.toHaveBeenCalled();
  });

  it("reports generation_failed when the model output is unusable", async () => {
    vi.mocked(storage.timeline.getUpcomingPlannedDays).mockResolvedValue([upcomingDay()] as never);
    vi.mocked(generatePlanAdjustment).mockResolvedValue(null);

    const result = await createPlanAdjustmentProposal(input);

    expect(result).toEqual({ kind: "generation_failed" });
  });
});

function fingerprintFor(day: ReturnType<typeof planDayRow>, sets: unknown[] = []) {
  return buildWorkoutPrescriptionFingerprint({
    mainWorkout: day.mainWorkout,
    accessory: (day.accessory as string | null) ?? undefined,
    notes: (day.notes as string | null) ?? undefined,
    exerciseDetails: sets.map((s) => mapExerciseSetToPromptDetail(s as never)),
  });
}

function enrichedChange(
  day: ReturnType<typeof planDayRow>,
  overrides: Partial<EnrichedPlanAdjustmentChange> = {},
): EnrichedPlanAdjustmentChange {
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
      fingerprint: fingerprintFor(day),
    },
    structured: false,
    hasStructureBlocks: false,
    ...overrides,
  };
}

function proposalRow(
  changes: EnrichedPlanAdjustmentChange[],
  overrides: Partial<PlanAdjustmentProposal> = {},
): PlanAdjustmentProposal {
  return {
    id: "prop-1",
    userId: "user-1",
    planId: "plan-1",
    status: "pending",
    summaryMessage: "Updated your week.",
    userRequest: "hyrox class please",
    payload: { changes },
    aiSource: null,
    createdAt: new Date(),
    resolvedAt: null,
    ...overrides,
  };
}

describe("applyPlanAdjustmentProposal", () => {
  it("returns undefined for an unknown proposal", async () => {
    vi.mocked(storage.planProposals.getById).mockResolvedValue(undefined);

    expect(await applyPlanAdjustmentProposal("user-1", "nope")).toBeUndefined();
  });

  it("rejects non-pending proposals", async () => {
    const day = planDayRow();
    vi.mocked(storage.planProposals.getById).mockResolvedValue(
      proposalRow([enrichedChange(day)], { status: "applied" }),
    );

    const result = await applyPlanAdjustmentProposal("user-1", "prop-1");

    expect(result).toMatchObject({ applied: false, reason: "not_pending" });
  });

  it("invalidates the proposal when a day's prescription changed since proposing", async () => {
    const day = planDayRow({ mainWorkout: "SOMETHING EDITED MEANWHILE" });
    const change = enrichedChange(planDayRow()); // baseline fingerprint from the ORIGINAL day
    vi.mocked(storage.planProposals.getById).mockResolvedValue(proposalRow([change]));
    vi.mocked(storage.plans.getPlanDay).mockResolvedValue(day);
    vi.mocked(storage.workouts.getExerciseSetsByPlanDay).mockResolvedValue([]);

    const result = await applyPlanAdjustmentProposal("user-1", "prop-1");

    expect(result).toMatchObject({
      applied: false,
      reason: "stale",
      staleChanges: [{ planDayId: "day-1", dayLabel: "Thu Jul 16 — Tempo Run" }],
    });
    expect(storage.planProposals.resolve).toHaveBeenCalledWith("prop-1", "user-1", "invalidated");
    expect(storage.plans.updatePlanDay).not.toHaveBeenCalled();
  });

  it("applies all changes transactionally and resolves the proposal", async () => {
    const day1 = planDayRow();
    const day2 = planDayRow({ id: "day-2", focus: "Intervals", mainWorkout: "8x400m" });
    const changes = [
      enrichedChange(day1),
      enrichedChange(day2, {
        planDayId: "day-2",
        updatedFields: { scheduledDate: "2026-07-18" },
        kind: "reschedule",
        baseline: { ...enrichedChange(day2).baseline, fingerprint: fingerprintFor(day2) },
      }),
    ];
    vi.mocked(storage.planProposals.getById).mockResolvedValue(proposalRow(changes));
    vi.mocked(storage.plans.getPlanDay).mockImplementation(async (dayId: string) =>
      (dayId === "day-1" ? day1 : day2),
    );
    vi.mocked(storage.workouts.getExerciseSetsByPlanDay).mockResolvedValue([]);
    vi.mocked(storage.users.getUser).mockResolvedValue({
      weightUnit: "kg",
      distanceUnit: "km",
    } as never);
    vi.mocked(storage.plans.updatePlanDay).mockResolvedValue(day1);
    vi.mocked(storage.planProposals.resolve).mockResolvedValue(
      proposalRow(changes, { status: "applied" }),
    );

    const result = await applyPlanAdjustmentProposal("user-1", "prop-1");

    expect(result).toEqual({ applied: true, changeCount: 2 });
    expect(storage.plans.updatePlanDay).toHaveBeenCalledTimes(2);
    const [dayId, updates] = vi.mocked(storage.plans.updatePlanDay).mock.calls[0];
    expect(dayId).toBe("day-1");
    expect(updates).toMatchObject({
      mainWorkout: "Full Hyrox class session",
      aiRationale: "Honors the class request.",
    });
    const [, rescheduleUpdates] = vi.mocked(storage.plans.updatePlanDay).mock.calls[1];
    expect(rescheduleUpdates).toMatchObject({ scheduledDate: "2026-07-18" });
    expect(storage.planProposals.resolve).toHaveBeenCalledWith(
      "prop-1",
      "user-1",
      "applied",
      dbMockState.tx,
    );
    expect(parseStructuredPlanDaySuggestionRows).not.toHaveBeenCalled();
  });

  it("clears exercise rows when converting a table-backed day to rest", async () => {
    const sets = [
      { id: "set-1", exerciseName: "rowing", category: "functional", setNumber: 1, sortOrder: 0 },
    ];
    const day = planDayRow();
    const change = enrichedChange(day, {
      updatedFields: { focus: "Rest", mainWorkout: "Complete rest or light walk", accessory: null },
      kind: "rest_conversion",
      structured: true,
      baseline: { ...enrichedChange(day).baseline, fingerprint: fingerprintFor(day, sets) },
    });
    vi.mocked(storage.planProposals.getById).mockResolvedValue(proposalRow([change]));
    vi.mocked(storage.plans.getPlanDay).mockResolvedValue(day);
    vi.mocked(storage.workouts.getExerciseSetsByPlanDay).mockResolvedValue(sets as never);
    vi.mocked(storage.users.getUser).mockResolvedValue({
      weightUnit: "kg",
      distanceUnit: "km",
    } as never);
    vi.mocked(storage.plans.updatePlanDay).mockResolvedValue(day);
    vi.mocked(storage.planProposals.resolve).mockResolvedValue(
      proposalRow([change], { status: "applied" }),
    );

    const result = await applyPlanAdjustmentProposal("user-1", "prop-1");

    expect(result).toEqual({ applied: true, changeCount: 1 });
    expect(dbMockState.tx.delete).toHaveBeenCalled();
    // Rest conversion skips the AI re-parse entirely.
    expect(parseStructuredPlanDaySuggestionRows).not.toHaveBeenCalled();
    const [, updates] = vi.mocked(storage.plans.updatePlanDay).mock.calls[0];
    expect(updates).toMatchObject({ focus: "Rest", mainWorkout: "Complete rest or light walk" });
  });

  it("keeps the proposal pending when a structured re-parse fails", async () => {
    const sets = [
      { id: "set-1", exerciseName: "rowing", category: "functional", setNumber: 1, sortOrder: 0 },
    ];
    const day = planDayRow();
    const change = enrichedChange(day, {
      structured: true,
      baseline: { ...enrichedChange(day).baseline, fingerprint: fingerprintFor(day, sets) },
    });
    vi.mocked(storage.planProposals.getById).mockResolvedValue(proposalRow([change]));
    vi.mocked(storage.plans.getPlanDay).mockResolvedValue(day);
    vi.mocked(storage.workouts.getExerciseSetsByPlanDay).mockResolvedValue(sets as never);
    vi.mocked(storage.users.getUser).mockResolvedValue({
      weightUnit: "kg",
      distanceUnit: "km",
    } as never);
    vi.mocked(parseStructuredPlanDaySuggestionRows).mockResolvedValue([]);

    const result = await applyPlanAdjustmentProposal("user-1", "prop-1");

    expect(result).toMatchObject({ applied: false, reason: "structured_parse_failed" });
    expect(storage.plans.updatePlanDay).not.toHaveBeenCalled();
    // Proposal is NOT invalidated — a retry may succeed.
    expect(storage.planProposals.resolve).not.toHaveBeenCalled();
  });
});
