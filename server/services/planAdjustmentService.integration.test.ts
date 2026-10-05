import {
  type EnrichedPlanAdjustmentChange,
  exerciseSets,
  type InsertExerciseSet,
  planDays,
  trainingPlans,
} from "@shared/schema";
import { asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../db";
import { storage } from "../storage";
import { resetIntegrationDb, seedUser } from "../storage/__tests__/integrationDb";
import {
  buildWorkoutPrescriptionFingerprint,
  mapExerciseSetToPromptDetail,
} from "./aiModificationGuard";
import { applyPlanAdjustmentProposal, undoPlanAdjustmentProposal } from "./planAdjustmentService";
import { parseStructuredPlanDaySuggestionRows } from "./structuredPlanDaySuggestion";

// The AI parse is the only thing stood in for: the rows, the locks and the
// writes are the real ones.
vi.mock("./structuredPlanDaySuggestion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./structuredPlanDaySuggestion")>()),
  parseStructuredPlanDaySuggestionRows: vi.fn(),
}));

vi.mock("./aiSuggestionService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./aiSuggestionService")>()),
  getStructuredApplyBlocker: vi.fn().mockResolvedValue(null),
}));

/**
 * Applying a proposal whose table-backed day needs an AI re-parse, while the
 * athlete edits that day during the parse — D45 (CODEBASE_ANALYSIS_2026-10-03).
 * The apply used to check the day before the parse, without a lock, and then
 * write from what it had read: the edit was written over, and the undo put
 * back the table as it was before the edit.
 */
describe("plan proposal apply during an edit (real Postgres)", () => {
  const ALICE = "apply-lock-alice";

  beforeEach(async () => {
    // The seeded day is Tue 4 Aug 2026, and an apply turns away any change
    // for a day before the athlete's today (C33), so the clock stands just
    // before it.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-03T09:00:00Z"));
    await resetIntegrationDb();
    await seedUser(ALICE);
    vi.mocked(parseStructuredPlanDaySuggestionRows).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  async function readDay(id: string) {
    const [day] = await db.select().from(planDays).where(eq(planDays.id, id));
    return day;
  }

  async function readSets(planDayId: string) {
    return await db
      .select()
      .from(exerciseSets)
      .where(eq(exerciseSets.planDayId, planDayId))
      .orderBy(asc(exerciseSets.sortOrder));
  }

  /** A squat day with a two-row table, and a pending proposal that swaps it for deadlifts at RPE 7. */
  async function seedProposal() {
    const [plan] = await db
      .insert(trainingPlans)
      .values({
        userId: ALICE,
        name: "Block",
        totalWeeks: 8,
        startDate: "2026-08-03",
        endDate: "2026-09-27",
      })
      .returning();
    const [day] = await db
      .insert(planDays)
      .values({
        planId: plan.id,
        weekNumber: 1,
        dayName: "Tuesday",
        focus: "Strength",
        mainWorkout: "Back squat 2x5",
        scheduledDate: "2026-08-04",
        expectedRpe: 8,
      })
      .returning();
    await db.insert(exerciseSets).values([
      {
        planDayId: day.id,
        exerciseName: "back_squat",
        category: "strength",
        setNumber: 1,
        plannedReps: 5,
        sortOrder: 0,
      },
      {
        planDayId: day.id,
        exerciseName: "back_squat",
        category: "strength",
        setNumber: 2,
        plannedReps: 5,
        sortOrder: 1,
      },
    ]);
    const sets = await readSets(day.id);
    const change: EnrichedPlanAdjustmentChange = {
      planDayId: day.id,
      updatedFields: { mainWorkout: "Deadlift 3x3", expectedRpe: 7 },
      rationale: "Rotate the hinge in.",
      kind: "workout_update",
      dayLabel: "Tue Aug 4 — Strength",
      baseline: {
        focus: day.focus,
        mainWorkout: day.mainWorkout,
        accessory: day.accessory,
        notes: day.notes,
        scheduledDate: day.scheduledDate,
        expectedDurationMin: day.expectedDurationMin,
        expectedRpe: day.expectedRpe,
        status: "planned",
        fingerprint: buildWorkoutPrescriptionFingerprint({
          mainWorkout: day.mainWorkout,
          exerciseDetails: sets.map(mapExerciseSetToPromptDetail),
        }),
      },
      structured: true,
      hasStructureBlocks: false,
    };
    const proposal = await storage.planProposals.create({
      userId: ALICE,
      planId: plan.id,
      summaryMessage: "Deadlifts on Tuesday.",
      userRequest: "swap squats for deadlifts",
      payload: { changes: [change] },
    });
    return { proposal, day, sets };
  }

  function deadliftRows(planDayId: string): InsertExerciseSet[] {
    return [
      {
        planDayId,
        exerciseName: "deadlift",
        category: "strength",
        setNumber: 1,
        plannedReps: 3,
        sortOrder: 0,
      },
    ];
  }

  /** The parse, with the athlete's edit committed while it runs. */
  function parseWhile(edit: () => Promise<unknown>, planDayId: string) {
    vi.mocked(parseStructuredPlanDaySuggestionRows).mockImplementation(async () => {
      await edit();
      return deadliftRows(planDayId);
    });
  }

  it("leaves a prescription edited during the parse alone, and invalidates the proposal", async () => {
    const { proposal, day, sets } = await seedProposal();
    parseWhile(
      () =>
        db.update(planDays).set({ notes: "Knee is sore, go light" }).where(eq(planDays.id, day.id)),
      day.id,
    );

    const result = await applyPlanAdjustmentProposal(ALICE, proposal.id);

    expect(result).toMatchObject({
      applied: false,
      reason: "stale",
      staleChanges: [{ planDayId: day.id }],
    });
    expect(await readDay(day.id)).toMatchObject({
      mainWorkout: "Back squat 2x5",
      notes: "Knee is sore, go light",
      expectedRpe: 8,
    });
    expect(await readSets(day.id)).toEqual(sets);
    expect((await storage.planProposals.getById(proposal.id, ALICE))?.status).toBe("invalidated");
  });

  it("leaves an exercise table edited during the parse alone", async () => {
    const { proposal, day, sets } = await seedProposal();
    const [first] = sets;
    parseWhile(
      () =>
        db
          .update(exerciseSets)
          .set({ exerciseName: "front_squat" })
          .where(eq(exerciseSets.id, first.id)),
      day.id,
    );

    const result = await applyPlanAdjustmentProposal(ALICE, proposal.id);

    expect(result).toMatchObject({ applied: false, reason: "stale" });
    const after = await readSets(day.id);
    expect(after.map((set) => set.exerciseName)).toEqual(["front_squat", "back_squat"]);
    expect(await readDay(day.id)).toMatchObject({ mainWorkout: "Back squat 2x5" });
  });

  it("records the undo from the day as it stands at the write, so an undo keeps the athlete's edit", async () => {
    const { proposal, day, sets } = await seedProposal();
    // RPE is not part of the prescription the proposal is checked against,
    // so the apply goes ahead; the undo must not put back the 8 read before
    // the parse.
    parseWhile(
      () => db.update(planDays).set({ expectedRpe: 6 }).where(eq(planDays.id, day.id)),
      day.id,
    );

    expect(await applyPlanAdjustmentProposal(ALICE, proposal.id)).toEqual({
      applied: true,
      changeCount: 1,
    });
    expect(await readDay(day.id)).toMatchObject({ expectedRpe: 7 });
    expect((await readSets(day.id)).map((set) => set.exerciseName)).toEqual(["deadlift"]);

    expect(await undoPlanAdjustmentProposal(ALICE, proposal.id)).toMatchObject({ undone: true });
    expect(await readDay(day.id)).toMatchObject({ mainWorkout: "Back squat 2x5", expectedRpe: 6 });
    expect(await readSets(day.id)).toEqual(sets);
  });

  it("answers the losing one of two overlapping applies with not_pending, not stale", async () => {
    const { proposal, day } = await seedProposal();
    // Both parses are held until both applies reach them, so both pass the
    // unlocked check and the loser meets the winner's write under the lock.
    let releaseParses: () => void = () => null;
    const bothParsing = new Promise<void>((resolve) => {
      releaseParses = resolve;
    });
    let parses = 0;
    vi.mocked(parseStructuredPlanDaySuggestionRows).mockImplementation(async () => {
      parses += 1;
      if (parses === 2) releaseParses();
      await bothParsing;
      return deadliftRows(day.id);
    });

    const results = await Promise.all([
      applyPlanAdjustmentProposal(ALICE, proposal.id),
      applyPlanAdjustmentProposal(ALICE, proposal.id),
    ]);

    expect(parses).toBe(2);
    expect(results).toEqual(
      expect.arrayContaining([
        { applied: true, changeCount: 1 },
        {
          applied: false,
          reason: "not_pending",
          message: "That proposal was already applied, dismissed, or replaced by a newer one.",
        },
      ]),
    );
    expect((await storage.planProposals.getById(proposal.id, ALICE))?.status).toBe("applied");
    expect((await readSets(day.id)).map((set) => set.exerciseName)).toEqual(["deadlift"]);
  });

  it("holds an edit made once the days are locked until it commits, so the edit lands after instead of between", async () => {
    const { proposal, day } = await seedProposal();
    vi.mocked(parseStructuredPlanDaySuggestionRows).mockResolvedValue(deadliftRows(day.id));
    let editSettled = false;
    let edit: Promise<unknown> = Promise.resolve();
    const realUpdate = storage.plans.updatePlanDay.bind(storage.plans);
    // The athlete saves a note from another request after the apply has
    // checked the day and before it writes.
    const spy = vi.spyOn(storage.plans, "updatePlanDay").mockImplementationOnce(async (...args) => {
      edit = db
        .update(planDays)
        .set({ notes: "Gym closes early" })
        .where(eq(planDays.id, day.id))
        .then(() => {
          editSettled = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(editSettled).toBe(false);
      return await realUpdate(...args);
    });

    try {
      expect(await applyPlanAdjustmentProposal(ALICE, proposal.id)).toEqual({
        applied: true,
        changeCount: 1,
      });
      await edit;
    } finally {
      spy.mockRestore();
    }

    expect(editSettled).toBe(true);
    expect(await readDay(day.id)).toMatchObject({ notes: "Gym closes early", expectedRpe: 7 });
  });
});
