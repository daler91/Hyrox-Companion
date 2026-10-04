import type { EnrichedPlanAdjustmentChange, PlanAdjustmentProposal, PlanProposalDayUndo } from "@shared/schema";
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
  undoPlanAdjustmentProposal,
} from "./planAdjustmentService";
import { setsFingerprint } from "./planProposalUndo";
import { loadRecentPlanChanges } from "./recentPlanChanges";
import { applyStructuredPlanDaySuggestionRows, parseStructuredPlanDaySuggestionRows } from "./structuredPlanDaySuggestion";
import { invalidateTrainingContext } from "./trainingContextCache";

/** What a storage call resolves to when no row matched: an unknown id, or a race another request won. */
const NO_ROW = undefined;

const dbMockState = vi.hoisted(() => {
  const deleteWhere = vi.fn(() => Promise.resolve());
  // The exercise table read back after an apply rewrites it.
  const selectWhere = vi.fn().mockResolvedValue([]);
  const insertValues = vi.fn(() => Promise.resolve());
  const tx = {
    delete: vi.fn(() => ({ where: deleteWhere })),
    select: vi.fn(() => ({ from: () => ({ where: selectWhere }) })),
    insert: vi.fn(() => ({ values: insertValues })),
  };
  return { deleteWhere, selectWhere, insertValues, tx };
});

vi.mock("../storage", () => ({
  storage: {
    users: { getUser: vi.fn() },
    workouts: { getExerciseSetsByPlanDay: vi.fn(), getExerciseSetsByPlanDays: vi.fn() },
    plans: { getPlanDay: vi.fn(), getPlanDaysByIds: vi.fn(), updatePlanDay: vi.fn() },
    timeline: { getUpcomingPlannedDays: vi.fn() },
    planProposals: {
      create: vi.fn(),
      getById: vi.fn(),
      getPending: vi.fn(),
      resolve: vi.fn(),
      markApplied: vi.fn(),
      markReverted: vi.fn(),
    },
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

vi.mock("./trainingContextCache", () => ({ invalidateTrainingContext: vi.fn() }));

// The record itself is covered in recentPlanChanges.test.ts.
vi.mock("./recentPlanChanges", () => ({ loadRecentPlanChanges: vi.fn().mockResolvedValue("") }));

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
    skipReason: null,
    priority: null,
    recovery: null,
    missedOn: null,
    recoveryUndo: null,
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

  it("gives the generation the plan changes already made, so an undo can restore them", async () => {
    const recent = "--- RECENT PLAN CHANGES ---\n- today, applied: Long Run moved from Monday 2026-07-20 to Sunday 2026-07-19.";
    vi.mocked(storage.timeline).getUpcomingPlannedDays.mockResolvedValue([upcomingDay()] as never);
    vi.mocked(loadRecentPlanChanges).mockResolvedValueOnce(recent);
    vi.mocked(generatePlanAdjustment).mockResolvedValue({ summaryMessage: "Done.", changes: [] });

    await createPlanAdjustmentProposal({ ...input, message: "undo that" });

    expect(loadRecentPlanChanges).toHaveBeenCalledWith("user-1");
    expect(vi.mocked(generatePlanAdjustment).mock.calls.at(-1)?.[0]).toMatchObject({ recentPlanChanges: recent, userMessage: "undo that" });
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
    vi.mocked(storage.plans.getPlanDaysByIds).mockImplementation(async (dayIds: string[]) =>
      dayIds.map((id) => planDayRow({ id })),
    );
    vi.mocked(storage.workouts.getExerciseSetsByPlanDays).mockResolvedValue(new Map());

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

  it("keeps one change per day, the first", async () => {
    vi.mocked(storage.timeline).getUpcomingPlannedDays.mockResolvedValue([upcomingDay()] as never);
    vi.mocked(generatePlanAdjustment).mockResolvedValue({
      summaryMessage: "Updated Thursday.",
      changes: [
        { planDayId: "day-1", updatedFields: { notes: "Keep it easy" }, rationale: "First." },
        { planDayId: "day-1", updatedFields: { expectedRpe: 4 }, rationale: "Second." },
      ],
    });
    vi.mocked(storage.plans).getPlanDaysByIds.mockResolvedValue([planDayRow()]);
    vi.mocked(storage.workouts).getExerciseSetsByPlanDays.mockResolvedValue(new Map());

    await createPlanAdjustmentProposal(input);

    const created = vi.mocked(storage.planProposals).create.mock.calls[0][0];
    expect(created.payload.changes).toHaveLength(1);
    expect(created.payload.changes[0].rationale).toBe("First.");
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

  describe("stopped by the athlete mid-draft (AI7)", () => {
    beforeEach(() => {
      vi.mocked(storage.timeline).getUpcomingPlannedDays.mockResolvedValue([upcomingDay()] as never);
      vi.mocked(storage.plans).getPlanDaysByIds.mockResolvedValue([planDayRow()]);
      vi.mocked(storage.workouts).getExerciseSetsByPlanDays.mockResolvedValue(new Map());
    });

    it("hands the chat's cancel signal to the drafting call", async () => {
      const controller = new AbortController();
      vi.mocked(generatePlanAdjustment).mockResolvedValue({ summaryMessage: "Done.", changes: [] });

      await createPlanAdjustmentProposal({ ...input, signal: controller.signal });

      expect(vi.mocked(generatePlanAdjustment).mock.calls[0]?.[0]).toMatchObject({ signal: controller.signal });
    });

    it("creates no proposal, so auto-apply has nothing to change the plan with", async () => {
      const controller = new AbortController();
      // The draft came back whole, but the athlete had already pressed Stop.
      vi.mocked(generatePlanAdjustment).mockImplementation(async () => {
        controller.abort();
        return {
          summaryMessage: "Moved Thursday.",
          changes: [{ planDayId: "day-1", updatedFields: { notes: "Keep it easy" }, rationale: "Class day." }],
        };
      });

      const result = await createPlanAdjustmentProposal({ ...input, signal: controller.signal });

      expect(result).toEqual({ kind: "aborted" });
      expect(vi.mocked(storage.planProposals).create.mock.calls).toEqual([]);
    });

    it("creates no proposal when Stop lands during the day reads after the draft", async () => {
      const controller = new AbortController();
      vi.mocked(generatePlanAdjustment).mockResolvedValue({
        summaryMessage: "Moved Thursday.",
        changes: [{ planDayId: "day-1", updatedFields: { notes: "Keep it easy" }, rationale: "Class day." }],
      });
      vi.mocked(storage.plans).getPlanDaysByIds.mockImplementation(async () => {
        controller.abort();
        return [planDayRow()];
      });

      const result = await createPlanAdjustmentProposal({ ...input, signal: controller.signal });

      expect(result).toEqual({ kind: "aborted" });
      expect(vi.mocked(storage.planProposals).create.mock.calls).toEqual([]);
    });

    it("reports a draft the cancel cut off as stopped, not as a generation failure", async () => {
      const controller = new AbortController();
      vi.mocked(generatePlanAdjustment).mockImplementation(async () => {
        controller.abort();
        throw new DOMException("This operation was aborted", "AbortError");
      });

      await expect(createPlanAdjustmentProposal({ ...input, signal: controller.signal })).resolves.toEqual({ kind: "aborted" });
      expect(vi.mocked(storage.planProposals).create.mock.calls).toEqual([]);
    });
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
    applyUndo: null,
    revertedAt: null,
    ...overrides,
  };
}

/**
 * One pending proposal for a table-backed "day-1" whose live rowing set still
 * matches the change's baseline fingerprint, with every storage read the apply
 * path makes mocked accordingly.
 */
function mockStructuredApplyScenario(overrides: Partial<EnrichedPlanAdjustmentChange> = {}) {
  const sets = [
    { id: "set-1", exerciseName: "rowing", category: "functional", setNumber: 1, sortOrder: 0 },
  ];
  const day = planDayRow();
  const change = enrichedChange(day, {
    structured: true,
    baseline: { ...enrichedChange(day).baseline, fingerprint: fingerprintFor(day, sets) },
    ...overrides,
  });
  vi.mocked(storage.planProposals.getById).mockResolvedValue(proposalRow([change]));
  vi.mocked(storage.plans.getPlanDaysByIds).mockResolvedValue([day]);
  vi.mocked(storage.workouts.getExerciseSetsByPlanDays).mockResolvedValue(
    new Map([["day-1", sets as never]]),
  );
  vi.mocked(storage.users.getUser).mockResolvedValue({
    weightUnit: "kg",
    distanceUnit: "km",
  } as never);
  return { day, change };
}

/** One pending, unstructured change on a day with no sets: apply reaches the update. */
function mockUnstructuredApplyScenario() {
  const day = planDayRow();
  vi.mocked(storage.planProposals.getById).mockResolvedValue(proposalRow([enrichedChange(day)]));
  vi.mocked(storage.plans.getPlanDaysByIds).mockResolvedValue([day]);
  vi.mocked(storage.workouts.getExerciseSetsByPlanDays).mockResolvedValue(new Map([["day-1", []]]));
  return day;
}

/** updatePlanDay returns the day with the update applied, as the real one does. */
function mockUpdatesStick(days: ReturnType<typeof planDayRow>[]) {
  vi.mocked(storage.plans).updatePlanDay.mockImplementation((id: string, updates: object) => {
    const day = days.find((d) => d.id === id);
    return Promise.resolve(day ? { ...day, ...updates } : NO_ROW);
  });
}

describe("applyPlanAdjustmentProposal", () => {
  it("returns undefined for an unknown proposal", async () => {
    vi.mocked(storage.planProposals).getById.mockResolvedValue(NO_ROW);

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
    vi.mocked(storage.plans.getPlanDaysByIds).mockResolvedValue([day]);
    vi.mocked(storage.workouts.getExerciseSetsByPlanDays).mockResolvedValue(
      new Map([["day-1", []]]),
    );

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
    vi.mocked(storage.plans.getPlanDaysByIds).mockResolvedValue([day1, day2]);
    vi.mocked(storage.workouts.getExerciseSetsByPlanDays).mockResolvedValue(
      new Map([
        ["day-1", []],
        ["day-2", []],
      ]),
    );
    vi.mocked(storage.users.getUser).mockResolvedValue({
      weightUnit: "kg",
      distanceUnit: "km",
    } as never);
    mockUpdatesStick([day1, day2]);
    vi.mocked(storage.planProposals.markApplied).mockResolvedValue(
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
    expect(storage.planProposals.markApplied).toHaveBeenCalledWith(
      "prop-1",
      "user-1",
      { days: [expect.objectContaining({ planDayId: "day-1" }), expect.objectContaining({ planDayId: "day-2" })] },
      dbMockState.tx,
    );
    expect(vi.mocked(storage.planProposals).resolve.mock.calls).toEqual([]);
    expect(parseStructuredPlanDaySuggestionRows).not.toHaveBeenCalled();
    // The coach chat's cached context no longer matches the plan.
    expect(invalidateTrainingContext).toHaveBeenCalledWith("user-1");
  });

  it("records what each day's apply replaced and wrote, for the undo", async () => {
    const day = mockUnstructuredApplyScenario();
    mockUpdatesStick([day]);
    vi.mocked(storage.planProposals.markApplied).mockResolvedValue(proposalRow([], { status: "applied" }));

    await applyPlanAdjustmentProposal("user-1", "prop-1");

    const [, , applyUndo] = vi.mocked(storage.planProposals.markApplied).mock.calls[0];
    const [, written] = vi.mocked(storage.plans).updatePlanDay.mock.calls[0];
    expect(applyUndo.days).toEqual([
      {
        planDayId: "day-1",
        fields: { mainWorkout: { before: "40min tempo", after: "Full Hyrox class session" } },
        coachNote: {
          before: { aiSource: null, aiRationale: null, aiNoteUpdatedAt: null, aiInputsUsed: null },
          writtenAt: (written.aiNoteUpdatedAt as Date).toISOString(),
        },
      },
    ]);
    // A free-text day's table is never touched, so there is none to restore.
    expect(dbMockState.tx.select).not.toHaveBeenCalled();
  });

  it("applies only the changes the athlete picked", async () => {
    const day1 = planDayRow();
    const day2 = planDayRow({ id: "day-2", focus: "Intervals", mainWorkout: "8x400m" });
    const changes = [
      enrichedChange(day1),
      enrichedChange(day2, {
        planDayId: "day-2",
        updatedFields: { expectedRpe: 6 },
        kind: "tune",
        baseline: { ...enrichedChange(day2).baseline, fingerprint: fingerprintFor(day2) },
      }),
    ];
    vi.mocked(storage.planProposals).getById.mockResolvedValue(proposalRow(changes));
    vi.mocked(storage.plans).getPlanDaysByIds.mockResolvedValue([day2]);
    vi.mocked(storage.workouts).getExerciseSetsByPlanDays.mockResolvedValue(new Map([["day-2", []]]));
    vi.mocked(storage.users).getUser.mockResolvedValue({ weightUnit: "kg", distanceUnit: "km" } as never);
    mockUpdatesStick([day2]);
    vi.mocked(storage.planProposals.markApplied).mockResolvedValue(proposalRow(changes, { status: "applied" }));

    const result = await applyPlanAdjustmentProposal("user-1", "prop-1", { planDayIds: ["day-2"] });

    expect(result).toEqual({ applied: true, changeCount: 1 });
    // Only the picked day is revalidated and written.
    expect(vi.mocked(storage.plans).getPlanDaysByIds.mock.calls).toContainEqual([["day-2"], "user-1"]);
    expect(vi.mocked(storage.plans).updatePlanDay.mock.calls).toHaveLength(1);
    expect(vi.mocked(storage.plans).updatePlanDay.mock.calls[0][0]).toBe("day-2");
    const [, , applyUndo] = vi.mocked(storage.planProposals.markApplied).mock.calls[0];
    expect(applyUndo.days.map((d) => d.planDayId)).toEqual(["day-2"]);
  });

  it("refuses a pick that names a day the proposal doesn't change", async () => {
    const day = planDayRow();
    vi.mocked(storage.planProposals).getById.mockResolvedValue(proposalRow([enrichedChange(day)]));

    const result = await applyPlanAdjustmentProposal("user-1", "prop-1", { planDayIds: ["day-1", "day-9"] });

    expect(result).toMatchObject({ applied: false, reason: "invalid_selection" });
    expect(vi.mocked(storage.plans).getPlanDaysByIds.mock.calls).toEqual([]);
    expect(vi.mocked(storage.plans).updatePlanDay.mock.calls).toEqual([]);
  });

  it("reports not_pending only when the proposal was resolved elsewhere mid-apply", async () => {
    const day = mockUnstructuredApplyScenario();
    vi.mocked(storage.plans.updatePlanDay).mockResolvedValue(day);
    // A concurrent dismiss won the race: markApplied() finds nothing pending.
    vi.mocked(storage.planProposals.markApplied).mockResolvedValue(NO_ROW);

    const result = await applyPlanAdjustmentProposal("user-1", "prop-1");

    expect(result).toMatchObject({ applied: false, reason: "not_pending" });
  });

  it("rethrows a transaction fault instead of reporting it as already applied", async () => {
    mockUnstructuredApplyScenario();
    // A statement timeout is a fault. It used to come back as not_pending —
    // a 409 telling the athlete the proposal was "already applied" while the
    // still-pending card re-rendered under that message.
    vi.mocked(storage.plans.updatePlanDay).mockRejectedValue(
      new Error("canceling statement due to statement timeout"),
    );

    await expect(applyPlanAdjustmentProposal("user-1", "prop-1")).rejects.toThrow(
      /statement timeout/,
    );
    expect(storage.planProposals.markApplied).not.toHaveBeenCalled();
  });

  it("clears exercise rows when converting a table-backed day to rest", async () => {
    const { day, change } = mockStructuredApplyScenario({
      updatedFields: { focus: "Rest", mainWorkout: "Complete rest or light walk", accessory: null },
      kind: "rest_conversion",
    });
    mockUpdatesStick([day]);
    vi.mocked(storage.planProposals.markApplied).mockResolvedValue(
      proposalRow([change], { status: "applied" }),
    );

    const result = await applyPlanAdjustmentProposal("user-1", "prop-1");

    expect(result).toEqual({ applied: true, changeCount: 1 });
    expect(dbMockState.tx.delete).toHaveBeenCalled();
    // Rest conversion skips the AI re-parse entirely.
    expect(parseStructuredPlanDaySuggestionRows).not.toHaveBeenCalled();
    const [, updates] = vi.mocked(storage.plans.updatePlanDay).mock.calls[0];
    expect(updates).toMatchObject({ focus: "Rest", mainWorkout: "Complete rest or light walk" });
    // The cleared table is kept whole, to put back on an undo.
    const [, , applyUndo] = vi.mocked(storage.planProposals.markApplied).mock.calls[0];
    expect(applyUndo.days[0].sets).toEqual({
      before: [expect.objectContaining({ id: "set-1", exerciseName: "rowing" })],
      afterFingerprint: setsFingerprint([]),
    });
  });

  it("keeps the replaced table and fingerprints the rows read back after a re-parse", async () => {
    const { day, change } = mockStructuredApplyScenario();
    const parsed = [{ planDayId: "day-1", exerciseName: "ski erg", category: "functional", setNumber: 1 }];
    vi.mocked(parseStructuredPlanDaySuggestionRows).mockResolvedValue(parsed);
    const stored = [{ ...parsed[0], id: "set-2", sortOrder: 0 }];
    dbMockState.selectWhere.mockResolvedValueOnce(stored);
    mockUpdatesStick([day]);
    vi.mocked(storage.planProposals.markApplied).mockResolvedValue(proposalRow([change], { status: "applied" }));

    await applyPlanAdjustmentProposal("user-1", "prop-1");

    expect(applyStructuredPlanDaySuggestionRows).toHaveBeenCalledWith("day-1", "replace", parsed, dbMockState.tx);
    const [, , applyUndo] = vi.mocked(storage.planProposals.markApplied).mock.calls[0];
    expect(applyUndo.days[0].sets?.afterFingerprint).toBe(setsFingerprint(stored as never));
    expect(applyUndo.days[0].sets?.before).toEqual([expect.objectContaining({ id: "set-1" })]);
  });

  it("keeps the proposal pending when a structured re-parse fails", async () => {
    mockStructuredApplyScenario();
    vi.mocked(parseStructuredPlanDaySuggestionRows).mockResolvedValue([]);

    const result = await applyPlanAdjustmentProposal("user-1", "prop-1");

    expect(result).toMatchObject({ applied: false, reason: "structured_parse_failed" });
    expect(storage.plans.updatePlanDay).not.toHaveBeenCalled();
    // Proposal is NOT invalidated — a retry may succeed.
    expect(storage.planProposals.resolve).not.toHaveBeenCalled();
  });
});

describe("undoPlanAdjustmentProposal", () => {
  const appliedAt = new Date();
  const noteWrittenAt = new Date("2026-07-10T08:00:00.000Z");

  /** day-1 as the apply left it: tempo swapped for the class, with the coach's note. */
  function appliedDay(overrides: Record<string, unknown> = {}) {
    return planDayRow({
      mainWorkout: "Full Hyrox class session",
      aiRationale: "Honors the class request.",
      aiNoteUpdatedAt: noteWrittenAt,
      ...overrides,
    });
  }

  function appliedProposal(dayUndo: Partial<PlanProposalDayUndo> = {}, overrides: Partial<PlanAdjustmentProposal> = {}) {
    const change = enrichedChange(planDayRow());
    return proposalRow([change], {
      status: "applied",
      resolvedAt: appliedAt,
      applyUndo: {
        days: [
          {
            planDayId: "day-1",
            fields: { mainWorkout: { before: "40min tempo", after: "Full Hyrox class session" } },
            coachNote: {
              before: { aiSource: null, aiRationale: null, aiNoteUpdatedAt: null, aiInputsUsed: null },
              writtenAt: noteWrittenAt.toISOString(),
            },
            ...dayUndo,
          },
        ],
      },
      ...overrides,
    });
  }

  function mockLiveDay(day: ReturnType<typeof planDayRow>, sets: unknown[] = []) {
    vi.mocked(storage.plans).getPlanDaysByIds.mockResolvedValue([day]);
    vi.mocked(storage.workouts).getExerciseSetsByPlanDays.mockResolvedValue(new Map([["day-1", sets as never]]));
    vi.mocked(storage.plans).updatePlanDay.mockResolvedValue(day);
    vi.mocked(storage.planProposals.markReverted).mockResolvedValue(appliedProposal({}, { status: "reverted" }));
  }

  it("is undefined for an unknown proposal", async () => {
    vi.mocked(storage.planProposals).getById.mockResolvedValue(NO_ROW);

    expect(await undoPlanAdjustmentProposal("user-1", "nope")).toBeUndefined();
  });

  it.each([
    ["a pending proposal", { status: "pending" }, "not_applied"],
    ["an undone proposal", { status: "reverted" }, "not_applied"],
    ["one applied before undo existed", { applyUndo: null }, "not_undoable"],
    ["one applied over a week ago", { resolvedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) }, "expired"],
  ] as const)("refuses %s", async (_label, overrides, reason) => {
    vi.mocked(storage.planProposals).getById.mockResolvedValue(appliedProposal({}, overrides));

    const result = await undoPlanAdjustmentProposal("user-1", "prop-1");

    expect(result).toMatchObject({ undone: false, reason });
    expect(vi.mocked(storage.plans).updatePlanDay.mock.calls).toEqual([]);
  });

  it("puts the day and its coach note back and marks the proposal reverted", async () => {
    vi.mocked(storage.planProposals).getById.mockResolvedValue(appliedProposal());
    mockLiveDay(appliedDay());

    const result = await undoPlanAdjustmentProposal("user-1", "prop-1");

    expect(result).toEqual({ undone: true, restoredCount: 1, keptDays: [] });
    expect(vi.mocked(storage.plans).updatePlanDay.mock.calls).toContainEqual([
      "day-1",
      { mainWorkout: "40min tempo", aiSource: null, aiRationale: null, aiNoteUpdatedAt: null, aiInputsUsed: null },
      "user-1",
      dbMockState.tx,
    ]);
    expect(storage.planProposals.markReverted).toHaveBeenCalledWith("prop-1", "user-1", dbMockState.tx);
    expect(invalidateTrainingContext).toHaveBeenCalledWith("user-1");
  });

  it("leaves what the athlete changed since, and says so", async () => {
    vi.mocked(storage.planProposals).getById.mockResolvedValue(appliedProposal());
    mockLiveDay(appliedDay({ mainWorkout: "Hyrox class, then 10 min easy" }));

    const result = await undoPlanAdjustmentProposal("user-1", "prop-1");

    expect(result).toEqual({
      undone: true,
      restoredCount: 1,
      keptDays: [{ planDayId: "day-1", dayLabel: "Thu Jul 16 — Tempo Run" }],
    });
    const [, update] = vi.mocked(storage.plans).updatePlanDay.mock.calls[0];
    expect(update).not.toHaveProperty("mainWorkout");
    expect(update).toMatchObject({ aiRationale: null });
  });

  it("puts a cleared exercise table back while it is still as the apply left it", async () => {
    const before = [{ id: "set-1", planDayId: "day-1", exerciseName: "rowing", category: "functional", setNumber: 1 }];
    vi.mocked(storage.planProposals).getById.mockResolvedValue(
      appliedProposal({ sets: { before: before as never, afterFingerprint: setsFingerprint([]) } }),
    );
    mockLiveDay(appliedDay());

    await undoPlanAdjustmentProposal("user-1", "prop-1");

    expect(dbMockState.tx.delete).toHaveBeenCalled();
    expect(dbMockState.insertValues).toHaveBeenCalledWith(before);
  });

  it("leaves an exercise table the athlete has edited since", async () => {
    const before = [{ id: "set-1", planDayId: "day-1", exerciseName: "rowing", category: "functional", setNumber: 1 }];
    vi.mocked(storage.planProposals).getById.mockResolvedValue(
      appliedProposal({ sets: { before: before as never, afterFingerprint: setsFingerprint([]) } }),
    );
    mockLiveDay(appliedDay(), [{ id: "set-9", exerciseName: "burpees", category: "functional", setNumber: 1 }]);

    const result = await undoPlanAdjustmentProposal("user-1", "prop-1");

    expect(dbMockState.insertValues).not.toHaveBeenCalled();
    expect(result).toMatchObject({ undone: true, keptDays: [{ planDayId: "day-1" }] });
  });

  it("changes nothing when every day has moved on", async () => {
    vi.mocked(storage.planProposals).getById.mockResolvedValue(appliedProposal());
    mockLiveDay(appliedDay({ status: "completed" }));

    const result = await undoPlanAdjustmentProposal("user-1", "prop-1");

    expect(result).toMatchObject({ undone: false, reason: "changed_since" });
    expect(vi.mocked(storage.plans).updatePlanDay.mock.calls).toEqual([]);
    expect(storage.planProposals.markReverted).not.toHaveBeenCalled();
  });

  it("reports not_applied when a concurrent undo won", async () => {
    vi.mocked(storage.planProposals).getById.mockResolvedValue(appliedProposal());
    mockLiveDay(appliedDay());
    vi.mocked(storage.planProposals.markReverted).mockResolvedValue(NO_ROW);

    const result = await undoPlanAdjustmentProposal("user-1", "prop-1");

    expect(result).toMatchObject({ undone: false, reason: "not_applied" });
  });
});

describe("derivePlanAdjustmentChangeKind — rest must be exact (audit H18)", () => {
  it("does not treat 'Active rest + mobility' as a rest conversion", () => {
    // rest_conversion is the one change kind that DELETES a table-backed day's
    // exercise rows. The focus test was /\brest\b/i, so this label matched and
    // the day's entire mobility prescription was silently dropped.
    expect(derivePlanAdjustmentChangeKind({ focus: "Active rest + mobility" })).toBe(
      "workout_update",
    );
    expect(derivePlanAdjustmentChangeKind({ focus: "Active Recovery / rest-ish" })).toBe(
      "workout_update",
    );
  });

  it("still recognises a genuine rest day", () => {
    for (const focus of ["Rest", "rest day", "  Complete Rest  ", "Full rest", "Day off", "Rest."]) {
      expect(derivePlanAdjustmentChangeKind({ focus })).toBe("rest_conversion");
    }
  });

  it("recognises a rest day declared through mainWorkout", () => {
    expect(derivePlanAdjustmentChangeKind({ mainWorkout: "Complete rest" })).toBe(
      "rest_conversion",
    );
    // ...but not one that merely mentions rest in a prescription.
    expect(
      derivePlanAdjustmentChangeKind({ mainWorkout: "3 rounds, 90s rest between sets" }),
    ).toBe("workout_update");
  });

  it("leaves non-prescription changes alone", () => {
    expect(derivePlanAdjustmentChangeKind({ scheduledDate: "2026-06-15" })).toBe("reschedule");
    expect(derivePlanAdjustmentChangeKind({})).toBe("tune");
  });
});
