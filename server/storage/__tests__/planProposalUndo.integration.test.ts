import { type EnrichedPlanAdjustmentChange, exerciseSets, planDays, trainingPlans } from "@shared/schema";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db";
import { buildWorkoutPrescriptionFingerprint, mapExerciseSetToPromptDetail } from "../../services/aiModificationGuard";
import { applyPlanAdjustmentProposal, undoPlanAdjustmentProposal } from "../../services/planAdjustmentService";
import { storage } from "../index";
import { resetIntegrationDb, seedUser } from "./integrationDb";

/**
 * Applying some or all of a plan proposal and undoing it, against the REAL
 * schema (AI coach chat review, I6): the undo record survives the jsonb round
 * trip, a cleared exercise table comes back row for row, and a field the
 * athlete changed after the apply stays theirs. Rest conversion and a
 * reschedule need no AI parse, so nothing here calls a model.
 */
describe("plan proposal apply and undo (real Postgres)", () => {
  const ALICE = "undo-alice";

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(ALICE);
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  async function readDay(id: string) {
    const [day] = await db.select().from(planDays).where(eq(planDays.id, id));
    return day;
  }

  async function readSets(planDayId: string) {
    return await db.select().from(exerciseSets).where(eq(exerciseSets.planDayId, planDayId)).orderBy(asc(exerciseSets.sortOrder));
  }

  /**
   * A strength day with a two-row exercise table, and a free-text run, with a
   * pending proposal that turns the strength day into rest and moves the run.
   */
  async function seedProposal() {
    const [plan] = await db
      .insert(trainingPlans)
      .values({ userId: ALICE, name: "Block", totalWeeks: 8, startDate: "2026-08-03", endDate: "2026-09-27" })
      .returning();
    const [strength, run] = await db
      .insert(planDays)
      .values([
        { planId: plan.id, weekNumber: 1, dayName: "Tuesday", focus: "Strength", mainWorkout: "Squats", scheduledDate: "2026-08-04", expectedRpe: 8 },
        { planId: plan.id, weekNumber: 1, dayName: "Thursday", focus: "Tempo Run", mainWorkout: "40min tempo", scheduledDate: "2026-08-06", expectedRpe: 7 },
      ])
      .returning();
    await db.insert(exerciseSets).values([
      { planDayId: strength.id, exerciseName: "back_squat", category: "strength", setNumber: 1, plannedReps: 5, plannedWeight: 102.5, weightUnit: "kg", sortOrder: 0, load: { kind: "percent_1rm", value: 80 } },
      { planDayId: strength.id, exerciseName: "back_squat", category: "strength", setNumber: 2, plannedReps: 5, plannedWeight: 102.5, weightUnit: "kg", sortOrder: 1 },
    ]);
    const strengthSets = await readSets(strength.id);

    const baseline = (day: typeof strength, sets: typeof strengthSets) => ({
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
        accessory: day.accessory ?? undefined,
        notes: day.notes ?? undefined,
        exerciseDetails: sets.map(mapExerciseSetToPromptDetail),
      }),
    });
    const changes: EnrichedPlanAdjustmentChange[] = [
      {
        planDayId: strength.id,
        updatedFields: { focus: "Rest", mainWorkout: "Complete rest" },
        rationale: "Your legs need the day.",
        kind: "rest_conversion",
        dayLabel: "Tue Aug 4 — Strength",
        baseline: baseline(strength, strengthSets),
        structured: true,
        hasStructureBlocks: false,
      },
      {
        planDayId: run.id,
        updatedFields: { scheduledDate: "2026-08-08", expectedRpe: 5 },
        rationale: "Saturday gives you a rest day first.",
        kind: "reschedule",
        dayLabel: "Thu Aug 6 — Tempo Run",
        baseline: baseline(run, []),
        structured: false,
        hasStructureBlocks: false,
      },
    ];
    const proposal = await storage.planProposals.create({
      userId: ALICE,
      planId: plan.id,
      summaryMessage: "Rest Tuesday, run Saturday.",
      userRequest: "my legs are wrecked",
      payload: { changes },
    });
    return { proposal, strength, run, strengthSets };
  }

  it("undoes an apply: the rest day gets its table back, and the athlete's own edit stays", async () => {
    const { proposal, strength, run, strengthSets } = await seedProposal();

    expect(await applyPlanAdjustmentProposal(ALICE, proposal.id)).toEqual({ applied: true, changeCount: 2 });
    expect(await readDay(strength.id)).toMatchObject({ focus: "Rest", mainWorkout: "Complete rest" });
    expect(await readSets(strength.id)).toEqual([]);
    expect(await readDay(run.id)).toMatchObject({ scheduledDate: "2026-08-08", expectedRpe: 5 });
    const applied = await storage.planProposals.getById(proposal.id, ALICE);
    expect(applied?.status).toBe("applied");
    expect(applied?.applyUndo?.days.map((day) => day.planDayId)).toEqual([strength.id, run.id]);

    // After the apply, the athlete makes Saturday's run a little harder.
    await db.update(planDays).set({ expectedRpe: 6 }).where(eq(planDays.id, run.id));

    const result = await undoPlanAdjustmentProposal(ALICE, proposal.id);

    expect(result).toEqual({
      undone: true,
      restoredCount: 2,
      keptDays: [{ planDayId: run.id, dayLabel: "Thu Aug 6 — Tempo Run" }],
    });
    expect(await readDay(strength.id)).toMatchObject({
      focus: "Strength",
      mainWorkout: "Squats",
      aiRationale: null,
      aiNoteUpdatedAt: null,
    });
    expect(await readSets(strength.id)).toEqual(strengthSets);
    expect(await readDay(run.id)).toMatchObject({ scheduledDate: "2026-08-06", expectedRpe: 6 });
    const reverted = await storage.planProposals.getById(proposal.id, ALICE);
    expect(reverted?.status).toBe("reverted");
    expect(reverted?.revertedAt).toBeInstanceOf(Date);

    expect(await undoPlanAdjustmentProposal(ALICE, proposal.id)).toMatchObject({ undone: false, reason: "not_applied" });
  });

  it("applies only the change the athlete picked", async () => {
    const { proposal, strength, run, strengthSets } = await seedProposal();

    expect(await applyPlanAdjustmentProposal(ALICE, proposal.id, { planDayIds: [run.id] })).toEqual({
      applied: true,
      changeCount: 1,
    });

    expect(await readDay(strength.id)).toMatchObject({ focus: "Strength", mainWorkout: "Squats" });
    expect(await readSets(strength.id)).toEqual(strengthSets);
    expect(await readDay(run.id)).toMatchObject({ scheduledDate: "2026-08-08" });
    const applied = await storage.planProposals.getById(proposal.id, ALICE);
    expect(applied?.applyUndo?.days.map((day) => day.planDayId)).toEqual([run.id]);
  });
});
