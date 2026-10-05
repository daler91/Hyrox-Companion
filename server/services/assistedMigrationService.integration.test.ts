import {
  exerciseSets,
  planDays,
  structuredExerciseBackfillReviews,
  trainingPlans,
  users,
  workoutLogs,
} from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../db";
import { seedUser, seedWorkoutLog } from "../storage/__tests__/integrationDb";
import { runAssistedMigrationBackfill } from "./assistedMigrationService";

const { parseExercisesFromText } = vi.hoisted(() => ({ parseExercisesFromText: vi.fn() }));
vi.mock("../gemini", () => ({ parseExercisesFromText }));

/**
 * The text the assisted-migration backfill sends to the AI parser, against
 * the real schema. Postgres trim() strips spaces only, so a log with no
 * accessory went out ending in a newline, and a log with neither text went
 * out as "\n": queued, sent to the parser, and flagged
 * parse_returned_no_rows. It now trims what JavaScript's trim() does, so a
 * vertical tab, a form feed or a no-break space is whitespace too.
 * D12 (CODEBASE_ANALYSIS_2026-10-03)
 *
 * Cleans up only its own athlete rather than resetting the whole database.
 */

const ATHLETE = "assisted-migration-text-athlete";

/** `days` from today, UTC: the backfill reads logs from the last 90 days and plan days after today. */
function dayOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function removeAthlete(): Promise<void> {
  const logs = await db
    .select({ id: workoutLogs.id })
    .from(workoutLogs)
    .where(eq(workoutLogs.userId, ATHLETE));
  if (logs.length > 0) {
    await db.delete(exerciseSets).where(
      inArray(
        exerciseSets.workoutLogId,
        logs.map((log) => log.id),
      ),
    );
    await db.delete(workoutLogs).where(eq(workoutLogs.userId, ATHLETE));
  }
  const plans = await db
    .select({ id: trainingPlans.id })
    .from(trainingPlans)
    .where(eq(trainingPlans.userId, ATHLETE));
  if (plans.length > 0) {
    const planIds = plans.map((plan) => plan.id);
    const days = await db
      .select({ id: planDays.id })
      .from(planDays)
      .where(inArray(planDays.planId, planIds));
    if (days.length > 0) {
      await db.delete(exerciseSets).where(
        inArray(
          exerciseSets.planDayId,
          days.map((day) => day.id),
        ),
      );
    }
    await db.delete(planDays).where(inArray(planDays.planId, planIds));
    await db.delete(trainingPlans).where(eq(trainingPlans.userId, ATHLETE));
  }
  await db
    .delete(structuredExerciseBackfillReviews)
    .where(eq(structuredExerciseBackfillReviews.userId, ATHLETE));
  await db.delete(users).where(eq(users.id, ATHLETE));
}

async function seedPlanDay(mainWorkout: string, accessory: string | null) {
  const [plan] = await db
    .insert(trainingPlans)
    .values({ userId: ATHLETE, name: "Build", totalWeeks: 4, startDate: dayOffset(1) })
    .returning();
  const [day] = await db
    .insert(planDays)
    .values({
      planId: plan.id,
      weekNumber: 1,
      dayName: "monday",
      focus: "Run",
      mainWorkout,
      accessory,
      scheduledDate: dayOffset(2),
      status: "planned",
    })
    .returning();
  return day;
}

async function reviewedOwners(): Promise<string[]> {
  const rows = await db
    .select({ ownerId: structuredExerciseBackfillReviews.ownerId })
    .from(structuredExerciseBackfillReviews)
    .where(eq(structuredExerciseBackfillReviews.userId, ATHLETE));
  return rows.map((row) => row.ownerId);
}

beforeEach(async () => {
  parseExercisesFromText.mockReset();
  parseExercisesFromText.mockResolvedValue([]);
  await removeAthlete();
  await seedUser(ATHLETE);
});

afterAll(async () => {
  await removeAthlete();
});

describe("runAssistedMigrationBackfill: the text it parses", () => {
  it("trims every kind of whitespace off the combined text, and skips a log or day with none", async () => {
    const mainOnly = await seedWorkoutLog(ATHLETE, dayOffset(-1), {
      mainWorkout: "Row 5x500 m",
      accessory: null,
    });
    const both = await seedWorkoutLog(ATHLETE, dayOffset(-2), {
      mainWorkout: "Bench 4x8\n",
      accessory: "\tCore 3x20 ",
    });
    const accessoryOnly = await seedWorkoutLog(ATHLETE, dayOffset(-3), {
      mainWorkout: "",
      accessory: "  Plank 3x1 min \r\n",
    });
    const empty = await seedWorkoutLog(ATHLETE, dayOffset(-4), {
      mainWorkout: "",
      accessory: null,
    });
    const blank = await seedWorkoutLog(ATHLETE, dayOffset(-5), {
      mainWorkout: " \t\r\n",
      accessory: "\n ",
    });
    // Whitespace Postgres's own trim never strips: a vertical tab, a form feed, no-break and ideographic spaces.
    const unicodeBlank = await seedWorkoutLog(ATHLETE, dayOffset(-6), {
      mainWorkout: "\v\f\u00a0",
      accessory: "\u3000\ufeff",
    });
    const unicodePadded = await seedWorkoutLog(ATHLETE, dayOffset(-7), {
      mainWorkout: "\u00a0Row 4x500 m\u2028",
      accessory: null,
    });
    const plannedRun = await seedPlanDay("Tempo 5 km", null);
    const blankDay = await seedPlanDay("  ", "\t");

    const result = await runAssistedMigrationBackfill(ATHLETE);

    const parsedTexts = parseExercisesFromText.mock.calls.map(([text]) => String(text));
    expect(parsedTexts).toEqual([
      "Row 5x500 m",
      "Bench 4x8\n\n\tCore 3x20",
      "Plank 3x1 min",
      "Row 4x500 m",
      "Tempo 5 km",
    ]);
    expect(result.queued).toBe(5);
    // A row with nothing to parse is never sent, so it is never flagged either.
    const flagged = await reviewedOwners();
    expect(flagged).toEqual(
      expect.arrayContaining([
        mainOnly.id,
        both.id,
        accessoryOnly.id,
        unicodePadded.id,
        plannedRun.id,
      ]),
    );
    for (const nothing of [empty, blank, unicodeBlank, blankDay]) {
      expect(flagged).not.toContain(nothing.id);
    }
  });
});
