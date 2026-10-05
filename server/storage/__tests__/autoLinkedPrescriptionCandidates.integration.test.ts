import { exerciseSets, planDays, trainingPlans, users, workoutLogs } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../../db";
import { runAssistedMigrationBackfill } from "../../services/assistedMigrationService";
import { storage } from "../index";
import { seedUser, seedWorkoutLog } from "./integrationDb";

/**
 * D12 (CODEBASE_ANALYSIS_2026-10-03), against the REAL schema: an auto device
 * link now records only what the watch measured, so a "Weight Training"
 * recording that completed a strength day leaves a log with the day's
 * prescription as its text and no sets. The two paths that turn set-less
 * text into sets (batch reparse via getWorkoutsWithoutExerciseSets, and the
 * assisted-migration backfill) must not parse that prescription back in as
 * performed sets, whether the link still stands or was undone after an RPE
 * (auto_link_recording_only is then all that marks the log). They read
 * `main_workout` and `accessory`, which on such a log are the plan's
 * whatever the athlete edited: the description editor writes
 * `prescribed_main_workout` / `prescribed_accessory`. So the log is skipped
 * outright, not while some column comparison holds. Everything else they
 * picked up before still qualifies, except a log that already has sets,
 * which the backfill's set check used to miss.
 *
 * Cleans up only its own athlete rather than resetting the whole database.
 */

const { parseExercisesFromText } = vi.hoisted(() => ({ parseExercisesFromText: vi.fn() }));
vi.mock("../../gemini", () => ({ parseExercisesFromText }));

const ATHLETE = "auto-linked-prescription-athlete";
const PRESCRIPTION = "Back Squat 5x5 @ 110 kg";
const PRESCRIBED_ACCESSORY = "Core: 3x20 sit-ups";

function daysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
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
    await db.delete(planDays).where(
      inArray(
        planDays.planId,
        plans.map((plan) => plan.id),
      ),
    );
    await db.delete(trainingPlans).where(eq(trainingPlans.userId, ATHLETE));
  }
  await db.delete(users).where(eq(users.id, ATHLETE));
}

describe("set-less text candidates skip unreviewed auto-linked prescription logs (real Postgres)", () => {
  const notes = new Map<string, string>();

  beforeAll(async () => {
    await removeAthlete();
    await seedUser(ATHLETE);
    const [plan] = await db
      .insert(trainingPlans)
      .values({ userId: ATHLETE, name: "Strength block", totalWeeks: 4 })
      .returning();
    const [day] = await db
      .insert(planDays)
      .values({
        planId: plan.id,
        weekNumber: 1,
        dayName: "Monday",
        focus: "Strength",
        mainWorkout: PRESCRIPTION,
        scheduledDate: daysAgo(3),
        status: "completed",
      })
      .returning();
    const autoLinkBase = {
      focus: "Strength",
      planDayId: day.id,
      planId: plan.id,
      source: "strava",
      deviceLinkSource: "auto",
      prescribedMainWorkout: PRESCRIPTION,
    };
    const seeded = [
      // The trigger: what createLogFromPlanDayWithStravaInTx writes for a
      // "Weight Training" recording since D12 — prescription text, no sets.
      [
        "autoLinkedUntouched",
        await seedWorkoutLog(ATHLETE, daysAgo(3), {
          ...autoLinkBase,
          mainWorkout: PRESCRIPTION,
          stravaActivityId: "9001",
        }),
      ],
      // The athlete edited the description, as the Review surface does: PATCH
      // {prescribedMainWorkout}. main_workout, the column the bulk paths
      // parse, is still the plan's 110 kg. D12 (CODEBASE_ANALYSIS_2026-10-03)
      [
        "autoLinkedDescriptionEdited",
        await seedWorkoutLog(ATHLETE, daysAgo(4), {
          ...autoLinkBase,
          mainWorkout: PRESCRIPTION,
          prescribedMainWorkout: "Back Squat 3x5 @ 90 kg, felt heavy",
          stravaActivityId: "9002",
        }),
      ],
      // main_workout itself rewritten (no client does; an API caller could):
      // still skipped. The bulk paths never parse a log an auto link created;
      // the per-log Parse is the athlete's way to parse their own words.
      [
        "autoLinkedMainRewritten",
        await seedWorkoutLog(ATHLETE, daysAgo(15), {
          ...autoLinkBase,
          mainWorkout: "Back Squat 3x5 @ 90 kg, felt heavy",
          stravaActivityId: "9005",
        }),
      ],
      // The athlete's own log that an auto link enriched keeps its source.
      [
        "ownLogAutoEnriched",
        await seedWorkoutLog(ATHLETE, daysAgo(5), {
          mainWorkout: "Deadlift 3x3",
          source: "manual",
          deviceLinkSource: "auto",
          stravaActivityId: "9003",
        }),
      ],
      // An ordinary typed log, and one with no source recorded at all.
      ["typedLog", await seedWorkoutLog(ATHLETE, daysAgo(6), { mainWorkout: "Bench 4x8" })],
      [
        "noSourceLog",
        await seedWorkoutLog(ATHLETE, daysAgo(7), { mainWorkout: "Row 5x500 m", source: null }),
      ],
      // Unlinked after only an RPE: adopted as the athlete's, link columns
      // cleared, no sets, the prescription as its text. Only the marker says
      // an auto link wrote it. D12 (CODEBASE_ANALYSIS_2026-10-03)
      [
        "autoLinkedUnlinked",
        await seedWorkoutLog(ATHLETE, daysAgo(8), {
          ...autoLinkBase,
          source: "manual",
          deviceLinkSource: null,
          autoLinkRecordingOnly: true,
          mainWorkout: PRESCRIPTION,
          rpe: 7,
        }),
      ],
      // Unlinked after a description edit: the same, main_workout the plan's.
      [
        "autoLinkedUnlinkedDescriptionEdited",
        await seedWorkoutLog(ATHLETE, daysAgo(16), {
          ...autoLinkBase,
          source: "manual",
          deviceLinkSource: null,
          autoLinkRecordingOnly: true,
          mainWorkout: PRESCRIPTION,
          prescribedMainWorkout: "Back Squat 3x5 @ 95 kg",
        }),
      ],
      // Unlinked, main_workout rewritten: skipped like the linked one.
      [
        "autoLinkedUnlinkedRewritten",
        await seedWorkoutLog(ATHLETE, daysAgo(9), {
          ...autoLinkBase,
          source: "manual",
          deviceLinkSource: null,
          autoLinkRecordingOnly: true,
          mainWorkout: "Back Squat 3x5 @ 95 kg",
        }),
      ],
      // The plan's accessory beside a main text that differs, linked still
      // and unlinked, and every text column rewritten: none of it is parsed.
      [
        "autoLinkedAccessoryKept",
        await seedWorkoutLog(ATHLETE, daysAgo(11), {
          ...autoLinkBase,
          mainWorkout: "6 km easy",
          accessory: PRESCRIBED_ACCESSORY,
          prescribedAccessory: PRESCRIBED_ACCESSORY,
          stravaActivityId: "9004",
        }),
      ],
      [
        "autoLinkedUnlinkedAccessoryKept",
        await seedWorkoutLog(ATHLETE, daysAgo(12), {
          ...autoLinkBase,
          source: "manual",
          deviceLinkSource: null,
          autoLinkRecordingOnly: true,
          mainWorkout: "6 km easy",
          accessory: PRESCRIBED_ACCESSORY,
          prescribedAccessory: PRESCRIBED_ACCESSORY,
        }),
      ],
      [
        "autoLinkedUnlinkedAllRewritten",
        await seedWorkoutLog(ATHLETE, daysAgo(13), {
          ...autoLinkBase,
          source: "manual",
          deviceLinkSource: null,
          autoLinkRecordingOnly: true,
          mainWorkout: "6 km easy",
          accessory: "Core: 2x20 sit-ups",
          prescribedAccessory: PRESCRIBED_ACCESSORY,
        }),
      ],
      // The athlete's own log of a plan day, its text the day's: no auto link
      // wrote it, so it qualifies as it always did.
      [
        "ownPlanDayLog",
        await seedWorkoutLog(ATHLETE, daysAgo(14), {
          focus: "Strength",
          planDayId: day.id,
          planId: plan.id,
          source: "manual",
          mainWorkout: PRESCRIPTION,
          prescribedMainWorkout: PRESCRIPTION,
          accessory: PRESCRIBED_ACCESSORY,
          prescribedAccessory: PRESCRIBED_ACCESSORY,
        }),
      ],
    ] as const;
    for (const [name, log] of seeded) notes.set(log.id, name);
    // A log that already has its sets: neither path may parse a second copy in.
    const withSets = await seedWorkoutLog(ATHLETE, daysAgo(10), { mainWorkout: "Deadlift 5x3" });
    await db
      .insert(exerciseSets)
      .values({
        workoutLogId: withSets.id,
        exerciseName: "deadlift",
        category: "strength",
        setNumber: 1,
        reps: 3,
        weight: 140,
      });
    notes.set(withSets.id, "logWithSets");
  });

  afterAll(async () => {
    await removeAthlete();
  });

  beforeEach(() => {
    parseExercisesFromText.mockReset();
    parseExercisesFromText.mockResolvedValue([]);
  });

  /**
   * The texts the parser was sent, trimmed: the backfill joins main and
   * accessory with a newline, which Postgres `trim()` leaves on a log with no
   * accessory, so an untrimmed "Bench 4x8\n" would never equal what it checks.
   */
  function parsedTexts(): string[] {
    return parseExercisesFromText.mock.calls.map(([text]) => String(text).trim());
  }

  function names(ids: Iterable<string>): string[] {
    return [...ids].map((id) => notes.get(id) ?? id).sort((a, b) => a.localeCompare(b));
  }

  it("getWorkoutsWithoutExerciseSets leaves out every log an auto link created, linked or unlinked", async () => {
    const workouts = await storage.workouts.getWorkoutsWithoutExerciseSets(ATHLETE);

    expect(names(workouts.map((workout) => workout.id))).toEqual([
      "noSourceLog",
      "ownLogAutoEnriched",
      "ownPlanDayLog",
      "typedLog",
    ]);
  });

  it("the assisted-migration backfill never sends the prescription to the parser", async () => {
    const result = await runAssistedMigrationBackfill(ATHLETE);

    const texts = parsedTexts();
    expect(texts).not.toContain(PRESCRIPTION);
    // The plan's accessory goes to the parser only from the athlete's own log of the day.
    expect(texts.filter((text) => text.includes(PRESCRIBED_ACCESSORY))).toEqual([
      `${PRESCRIPTION}\n${PRESCRIBED_ACCESSORY}`,
    ]);
    expect(
      texts.filter((text) => text.includes("6 km easy") || text.includes("Back Squat 3x5")),
    ).toEqual([]);
    expect([...texts].sort((a, b) => a.localeCompare(b))).toEqual([
      `${PRESCRIPTION}\n${PRESCRIBED_ACCESSORY}`,
      "Bench 4x8",
      "Deadlift 3x3",
      "Row 5x500 m",
    ]);
    expect(result.queued).toBe(4);
  });

  it("the assisted-migration backfill skips a log that already has its sets", async () => {
    await runAssistedMigrationBackfill(ATHLETE);

    const texts = parsedTexts();
    expect(texts).not.toContain("Deadlift 5x3");
  });
});
