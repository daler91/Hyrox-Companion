import { type ParsedExercise, planDays, trainingPlans, users, workoutLogs } from "@shared/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../../db";
import { parseWorkoutStructureFromTextWithDiagnostics } from "../../gemini";
import {
  resetIntegrationDb,
  seedExerciseSet,
  seedUser,
  seedWorkoutLog,
} from "../../storage/__tests__/integrationDb";
import { enqueueAutoCoachInBackground } from "../autoCoachQueue";
import { reparseWorkoutUseCase } from "../parseWorkoutUseCases";

vi.mock("../../gemini", () => ({ parseWorkoutStructureFromTextWithDiagnostics: vi.fn() }));
vi.mock("../autoCoachQueue", () => ({ enqueueAutoCoachInBackground: vi.fn() }));

/**
 * A reparse replaces every set on the log. On a plan-linked log that has to
 * end like any other logged-set edit, against the REAL schema: the adherence
 * snapshot recomputed from the new sets and the coach re-queued. It used to
 * stop at the write, so the log kept the compliance_pct and coach note of the
 * exercises it no longer had (C32, CODEBASE_ANALYSIS_2026-10-03).
 */
describe("reparseWorkoutUseCase on a plan-linked log (real Postgres)", () => {
  const ALICE = "reparse-derived-alice";
  let logId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    await resetIntegrationDb();
    await seedUser(ALICE);
    await db.update(users).set({ aiCoachEnabled: true }).where(eq(users.id, ALICE));

    const [plan] = await db
      .insert(trainingPlans)
      .values({
        userId: ALICE,
        name: "Block",
        totalWeeks: 1,
        startDate: "2026-05-04",
        endDate: "2026-05-10",
      })
      .returning();
    const [day] = await db
      .insert(planDays)
      .values({
        planId: plan.id,
        weekNumber: 1,
        dayName: "Monday",
        focus: "Strength",
        mainWorkout: "3x5 back squat",
        scheduledDate: "2026-05-04",
        status: "completed",
      })
      .returning();
    const log = await seedWorkoutLog(ALICE, "2026-05-04", {
      planDayId: day.id,
      planId: plan.id,
      mainWorkout: "3x5 back squat",
      plannedSetCount: 3,
      actualSetCount: 3,
      matchedSetCount: 3,
      addedSetCount: 0,
      removedSetCount: 0,
      compliancePct: 100,
    });
    logId = log.id;
    for (const setNumber of [1, 2, 3]) {
      const set = {
        exerciseName: "back_squat",
        category: "strength",
        setNumber,
        reps: 5,
        weight: 100,
      };
      await seedExerciseSet({ ...set, planDayId: day.id, sortOrder: setNumber });
      await seedExerciseSet({ ...set, workoutLogId: log.id, sortOrder: setNumber });
    }

    // The athlete corrects the text: it was deadlifts, not squats.
    const deadlifts = {
      exerciseName: "deadlift",
      category: "strength",
      sets: [1, 2, 3].map((setNumber) => ({ setNumber, reps: 5, weight: 140 })),
    } as unknown as ParsedExercise;
    vi.mocked(parseWorkoutStructureFromTextWithDiagnostics).mockResolvedValue({
      acceptedRows: [deadlifts],
      rejectedRows: [],
      fallbackUsed: false,
      structureBlocks: [],
      warnings: [],
      confidence: null,
    });
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  it("recomputes compliance against the plan day and re-queues the coach", async () => {
    const outcome = await reparseWorkoutUseCase({
      userId: ALICE,
      workoutId: logId,
      payload: { prescribedMainWorkout: "3x5 deadlift" },
    });

    expect(outcome.status).toBe("ok");
    const [log] = await db.select().from(workoutLogs).where(eq(workoutLogs.id, logId));
    expect(log).toMatchObject({
      plannedSetCount: 3,
      actualSetCount: 3,
      matchedSetCount: 0,
      addedSetCount: 3,
      removedSetCount: 3,
      compliancePct: 0,
    });
    expect(enqueueAutoCoachInBackground).toHaveBeenCalledWith(ALICE, "logged-sets-edited");
  });
});
