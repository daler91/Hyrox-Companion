import {
  exerciseSets,
  insertWorkoutLogSchema,
  planDays,
  type StravaActivitySummary,
  trainingPlans,
  users,
  workoutLogs,
} from "@shared/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../db";
import { createWorkoutRouteSchema, updateWorkoutRouteSchema } from "../routes/workouts/shared";
import { storage } from "../storage";
import { seedExerciseSet, seedUser, seedWorkoutLog } from "../storage/__tests__/integrationDb";
import { runAssistedMigrationBackfill } from "./assistedMigrationService";
import { combineWorkouts } from "./combineWorkouts";
import {
  createLogFromPlanDayWithStravaInTx,
  pickDeviceMetrics,
  unlinkDeviceActivity,
} from "./deviceActivityLink";
import { updatePlanDayStatus } from "./planService";
import { mapStravaActivityToWorkout } from "./stravaMapper";
import { batchReparseWorkouts } from "./workoutService";
import { createWorkout, updateWorkoutUseCase } from "./workoutUseCases";

/**
 * D12 (CODEBASE_ANALYSIS_2026-10-03), against the real schema: a plan-day log
 * an auto link created holds the recording and none of the prescription, and
 * `workout_logs.auto_link_recording_only` (migration 0120) is what still says
 * so after unlink. Unlinking an edited log adopts it as the athlete's
 * (`source = 'manual'`, every link column cleared), and before the marker
 * nothing on the row told it from their own log:
 *
 *  (a) the athlete added strides to an auto-linked 8 km day, unlinked the
 *      recording, then reopened the day: the day's prescription was replaced
 *      by the log's sets, [strides], and the 8 km was gone;
 *  (b) the athlete only rated the session, then unlinked: a set-less log
 *      whose text is the prescription. Reopening replaced the day's sets with
 *      its empty list, and batch reparse, GET /workouts/unstructured and the
 *      assisted-migration backfill would parse the prescription into sets as
 *      if it had been performed.
 *
 * Cleans up only its own athlete rather than resetting the whole database.
 */

const { parseExercisesFromText } = vi.hoisted(() => ({ parseExercisesFromText: vi.fn() }));
vi.mock("../gemini", () => ({ parseExercisesFromText }));

const ATHLETE = "unlinked-auto-link-athlete";

/** Inside the assisted-migration backfill's 90-day window. */
function daysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

const DAY_DATE = daysAgo(3);

const SHORT_RUN: StravaActivitySummary = {
  id: 779001,
  name: "Morning Run",
  type: "Run",
  sport_type: "Run",
  start_date: `${DAY_DATE}T05:30:00Z`,
  start_date_local: `${DAY_DATE}T06:30:00Z`,
  distance: 6100,
  moving_time: 30 * 60,
  elapsed_time: 31 * 60,
  total_elevation_gain: 20,
  average_speed: 3.4,
  max_speed: 4.1,
};

const WEIGHT_TRAINING: StravaActivitySummary = {
  ...SHORT_RUN,
  id: 779002,
  name: "Evening Weight Training",
  type: "WeightTraining",
  sport_type: "WeightTraining",
  distance: 0,
};

const TEMPO_TEXT = "8 km tempo";
const SQUAT_TEXT = "Back squat 3x5 @ 110 kg";

type Prescription = {
  exerciseName: string;
  category: string;
  distance?: number;
  reps?: number;
  weight?: number;
};

const EIGHT_KM: Prescription = { exerciseName: "run", category: "running", distance: 8000 };
const BACK_SQUAT: Prescription = {
  exerciseName: "back_squat",
  category: "strength",
  reps: 5,
  weight: 110,
};
const DEADLIFT: Prescription = {
  exerciseName: "deadlift",
  category: "strength",
  reps: 3,
  weight: 140,
};

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
  await db.delete(users).where(eq(users.id, ATHLETE));
}

/** A plan day prescribing `sets` in this order, each numbered within its exercise. */
async function seedSession(focus: string, mainWorkout: string, sets: Prescription[]) {
  const [plan] = await db
    .insert(trainingPlans)
    .values({ userId: ATHLETE, name: "Build", totalWeeks: 4, startDate: DAY_DATE })
    .returning();
  const [day] = await db
    .insert(planDays)
    .values({
      planId: plan.id,
      weekNumber: 1,
      dayName: "monday",
      focus,
      mainWorkout,
      scheduledDate: DAY_DATE,
      status: "planned",
    })
    .returning();
  for (const [sortOrder, set] of sets.entries()) {
    const setNumber = sets
      .slice(0, sortOrder + 1)
      .filter((other) => other.exerciseName === set.exerciseName).length;
    await seedExerciseSet({ planDayId: day.id, setNumber, sortOrder, ...set });
  }
  return day;
}

function link(
  day: typeof planDays.$inferSelect,
  raw: StravaActivitySummary,
  linkSource: "auto" | "manual" = "auto",
) {
  return db.transaction((tx) =>
    createLogFromPlanDayWithStravaInTx(tx, {
      userId: ATHLETE,
      planDay: day,
      raw,
      metrics: pickDeviceMetrics(mapStravaActivityToWorkout(raw, ATHLETE, "km")),
      linkSource,
      confidence: linkSource === "auto" ? 0.8 : null,
    }),
  );
}

/** The athlete rates the session: an edit, so unlink keeps the log as theirs. */
async function rate(logId: string): Promise<void> {
  await db.update(workoutLogs).set({ rpe: 7 }).where(eq(workoutLogs.id, logId));
}

function unlink(logId: string) {
  return unlinkDeviceActivity({ userId: ATHLETE, logId, distanceUnit: "km" });
}

function reopen(dayId: string) {
  return updatePlanDayStatus(dayId, { status: "planned" }, ATHLETE);
}

async function setsOn(owner: { planDayId: string } | { workoutLogId: string }) {
  return await db
    .select({
      exerciseName: exerciseSets.exerciseName,
      distance: exerciseSets.distance,
      reps: exerciseSets.reps,
      weight: exerciseSets.weight,
      sortOrder: exerciseSets.sortOrder,
    })
    .from(exerciseSets)
    .where(
      "planDayId" in owner
        ? eq(exerciseSets.planDayId, owner.planDayId)
        : eq(exerciseSets.workoutLogId, owner.workoutLogId),
    )
    .orderBy(exerciseSets.sortOrder);
}

/** The run the released recording carries on its own row. */
async function releasedRunDistances(standaloneId: string) {
  const sets = await setsOn({ workoutLogId: standaloneId });
  return sets.map((set) => [set.exerciseName, set.distance]);
}

const row = (
  exerciseName: string,
  sortOrder: number,
  values: { distance?: number; reps?: number; weight?: number } = {},
) => ({
  exerciseName,
  distance: values.distance ?? null,
  reps: values.reps ?? null,
  weight: values.weight ?? null,
  sortOrder,
});

beforeEach(async () => {
  parseExercisesFromText.mockReset();
  parseExercisesFromText.mockResolvedValue([]);
  await removeAthlete();
  await seedUser(ATHLETE);
});

afterAll(async () => {
  await removeAthlete();
});

describe("auto_link_recording_only (migration 0120)", () => {
  it("is a NOT NULL boolean that defaults to false, so every existing log reads as not D12-shaped", async () => {
    const { rows } = await db.execute<{
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(sql`
      SELECT data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'workout_logs' AND column_name = 'auto_link_recording_only'
    `);
    expect(rows).toEqual([{ data_type: "boolean", is_nullable: "NO", column_default: "false" }]);

    const typed = await seedWorkoutLog(ATHLETE, DAY_DATE, { mainWorkout: "Bench 4x8" });
    expect(typed.autoLinkRecordingOnly).toBe(false);
  });

  it("is set by an auto link that creates a plan day's log, and by nothing the athlete links", async () => {
    const autoDay = await seedSession("Tempo run", TEMPO_TEXT, [EIGHT_KM]);
    const manualDay = await seedSession("Strength", SQUAT_TEXT, [BACK_SQUAT]);

    const auto = await link(autoDay, SHORT_RUN);
    const manual = await link(manualDay, WEIGHT_TRAINING, "manual");

    expect(auto.autoLinkRecordingOnly).toBe(true);
    expect(manual.autoLinkRecordingOnly).toBe(false);
  });
});

/**
 * Only the auto link writes the marker. A request that could clear it would
 * bring gaps (a) and (b) back; one that could set it would hide the athlete's
 * own log from parsing and fold it onto its day as if it held none of the
 * prescription. Through the route schemas each write path validates with,
 * against the real rows.
 */
describe("auto_link_recording_only is the server's: no request writes it", () => {
  it("a PATCH cannot clear it, so reopening after one still keeps the 8 km", async () => {
    const day = await seedSession("Tempo run", TEMPO_TEXT, [EIGHT_KM]);
    const log = await link(day, SHORT_RUN);
    await seedExerciseSet({
      workoutLogId: log.id,
      exerciseName: "strides",
      category: "running",
      setNumber: 1,
      reps: 6,
      sortOrder: 1,
    });
    await unlink(log.id);

    const payload = updateWorkoutRouteSchema.parse({
      notes: "Legs heavy",
      autoLinkRecordingOnly: false,
    });
    expect(payload).not.toHaveProperty("autoLinkRecordingOnly");
    await updateWorkoutUseCase({ userId: ATHLETE, workoutId: log.id, payload });

    const [patched] = await db.select().from(workoutLogs).where(eq(workoutLogs.id, log.id));
    expect(patched).toMatchObject({ notes: "Legs heavy", autoLinkRecordingOnly: true });

    await reopen(day.id);

    expect(await setsOn({ planDayId: day.id })).toEqual([
      row("run", 0, { distance: 8000 }),
      row("strides", 1, { reps: 6 }),
    ]);
  });

  it("a PATCH cannot clear it on a log unlinked after only an RPE, so it stays out of the parse", async () => {
    const day = await seedSession("Strength", SQUAT_TEXT, [BACK_SQUAT]);
    const log = await link(day, WEIGHT_TRAINING);
    await rate(log.id);
    await unlink(log.id);

    await updateWorkoutUseCase({
      userId: ATHLETE,
      workoutId: log.id,
      payload: updateWorkoutRouteSchema.parse({ rpe: 8, autoLinkRecordingOnly: false }),
    });

    const unstructured = await storage.workouts.getWorkoutsWithoutExerciseSets(ATHLETE);
    expect(unstructured.map((workout) => workout.id)).not.toContain(log.id);
  });

  it("a POST cannot set it on the athlete's own log", async () => {
    const payload = createWorkoutRouteSchema.parse({
      date: DAY_DATE,
      focus: "Strength",
      mainWorkout: "Bench 4x8",
      autoLinkRecordingOnly: true,
    });
    expect(payload).not.toHaveProperty("autoLinkRecordingOnly");

    const created = await createWorkout({ userId: ATHLETE, payload });

    const [stored] = await db.select().from(workoutLogs).where(eq(workoutLogs.id, created.id));
    expect(stored.autoLinkRecordingOnly).toBe(false);
  });

  it("combining workouts cannot set it on the merged log", async () => {
    const source = await seedWorkoutLog(ATHLETE, DAY_DATE, { mainWorkout: "Row 5x500 m" });
    // POST /api/v1/workouts/combine validates `newWorkout` with insertWorkoutLogSchema.
    const newWorkout = insertWorkoutLogSchema.parse({
      date: DAY_DATE,
      focus: "Row",
      mainWorkout: "Row 5x500 m",
      autoLinkRecordingOnly: true,
    });
    expect(newWorkout).not.toHaveProperty("autoLinkRecordingOnly");

    const merged = await combineWorkouts({ userId: ATHLETE, newWorkout, deleteWorkoutIds: [source.id] });

    expect(merged.autoLinkRecordingOnly).toBe(false);
  });
});

describe("reopening a day after unlinking its auto-linked log (gap a)", () => {
  it("keeps the 8 km and appends the strides the athlete added", async () => {
    const day = await seedSession("Tempo run", TEMPO_TEXT, [EIGHT_KM]);
    const log = await link(day, SHORT_RUN);
    await seedExerciseSet({
      workoutLogId: log.id,
      exerciseName: "strides",
      category: "running",
      setNumber: 1,
      reps: 6,
      sortOrder: 1,
    });

    const { log: adopted, standalone } = await unlink(log.id);

    // Adopted as the athlete's, the link columns cleared, the marker kept.
    expect(adopted).toMatchObject({
      id: log.id,
      source: "manual",
      stravaActivityId: null,
      deviceLinkSource: null,
      deviceActivity: null,
      autoLinkRecordingOnly: true,
    });
    expect(await setsOn({ workoutLogId: log.id })).toEqual([row("strides", 1, { reps: 6 })]);

    await reopen(day.id);

    expect(await setsOn({ planDayId: day.id })).toEqual([
      row("run", 0, { distance: 8000 }),
      row("strides", 1, { reps: 6 }),
    ]);
    expect(await releasedRunDistances(standalone.id)).toEqual([["run", 6100]]);
  });

  it("keeps the 8 km when the strides were typed as runs", async () => {
    const day = await seedSession("Tempo run", TEMPO_TEXT, [EIGHT_KM]);
    const log = await link(day, SHORT_RUN);
    await seedExerciseSet({
      workoutLogId: log.id,
      exerciseName: "run",
      category: "running",
      setNumber: 2,
      reps: 6,
      distance: 100,
      distanceUnit: "m",
      sortOrder: 1,
    });

    await unlink(log.id);
    await reopen(day.id);

    expect(await setsOn({ planDayId: day.id })).toEqual([
      row("run", 0, { distance: 8000 }),
      row("run", 1, { distance: 100, reps: 6 }),
    ]);
  });

  it("never reads a run left on the log as the prescribed one: the corrected recording's run goes after the 8 km", async () => {
    // They corrected the watch's 6.1 km to 6.0 (storage bumps the version),
    // then said the recording was not this session. The set is theirs, so it
    // stays on the log, but nothing says it is their version of the 8 km.
    const day = await seedSession("Tempo run", TEMPO_TEXT, [EIGHT_KM]);
    const log = await link(day, SHORT_RUN);
    await db
      .update(exerciseSets)
      .set({ distance: 6000, version: 2 })
      .where(eq(exerciseSets.workoutLogId, log.id));

    await unlink(log.id);
    await reopen(day.id);

    expect(await setsOn({ planDayId: day.id })).toEqual([
      row("run", 0, { distance: 8000 }),
      row("run", 1, { distance: 6000 }),
    ]);
  });

  it("replaces only the lift the athlete logged on a 'Weight Training' day and keeps the rest", async () => {
    const day = await seedSession("Strength", SQUAT_TEXT, [BACK_SQUAT, DEADLIFT]);
    const log = await link(day, WEIGHT_TRAINING);
    // The link wrote no set; they squatted 100 kg, not 110, and logged nothing else.
    await seedExerciseSet({
      workoutLogId: log.id,
      ...BACK_SQUAT,
      weight: 100,
      setNumber: 1,
      sortOrder: 0,
    });

    await unlink(log.id);
    await reopen(day.id);

    expect(await setsOn({ planDayId: day.id })).toEqual([
      row("back_squat", 0, { reps: 5, weight: 100 }),
      row("deadlift", 1, { reps: 3, weight: 140 }),
    ]);
  });
});

describe("a log unlinked after only an RPE (gap b)", () => {
  it("leaves the day's prescription untouched on reopen", async () => {
    const day = await seedSession("Strength", SQUAT_TEXT, [BACK_SQUAT, BACK_SQUAT, BACK_SQUAT]);
    const log = await link(day, WEIGHT_TRAINING);
    await rate(log.id);

    const { log: adopted } = await unlink(log.id);
    expect(adopted).toMatchObject({ source: "manual", rpe: 7, autoLinkRecordingOnly: true });
    expect(await setsOn({ workoutLogId: log.id })).toEqual([]);

    await reopen(day.id);

    expect(await setsOn({ planDayId: day.id })).toEqual([
      row("back_squat", 0, { reps: 5, weight: 110 }),
      row("back_squat", 1, { reps: 5, weight: 110 }),
      row("back_squat", 2, { reps: 5, weight: 110 }),
    ]);
  });

  it("is not a candidate to parse: its text is the prescription", async () => {
    const day = await seedSession("Tempo run", TEMPO_TEXT, [EIGHT_KM]);
    const log = await link(day, SHORT_RUN);
    await rate(log.id);

    await unlink(log.id);
    // The recording's set left with the recording: a set-less manual log
    // whose description is the plan's.
    const [adopted] = await db.select().from(workoutLogs).where(eq(workoutLogs.id, log.id));
    expect(adopted).toMatchObject({
      source: "manual",
      mainWorkout: TEMPO_TEXT,
      deviceLinkSource: null,
      autoLinkRecordingOnly: true,
    });
    expect(await setsOn({ workoutLogId: log.id })).toEqual([]);

    // GET /api/v1/workouts/unstructured and batch reparse read this.
    const unstructured = await storage.workouts.getWorkoutsWithoutExerciseSets(ATHLETE);
    expect(unstructured.map((workout) => workout.id)).not.toContain(log.id);

    const reparsed = await batchReparseWorkouts(ATHLETE);
    const backfill = await runAssistedMigrationBackfill(ATHLETE);
    const parsedTexts = parseExercisesFromText.mock.calls.map(([text]) => String(text).trim());
    expect(parsedTexts).not.toContain(TEMPO_TEXT);
    expect(reparsed.total).toBe(0);
    expect(backfill.queued).toBe(0);
  });
});

/**
 * The Review surface's "Workout description" editor is the only client path
 * that edits a log's text, and it sends PATCH {prescribedMainWorkout} or
 * {prescribedAccessory}. `main_workout` and `accessory`, which batch reparse,
 * GET /workouts/unstructured and the assisted-migration backfill read, stay
 * the plan's. Reading "the two columns differ" as "the athlete rewrote it"
 * sent the plan's text to the parser after one description edit, and the
 * editor opens by default on a set-less log, which is what a "Weight
 * Training" auto link leaves. Through the real route schema and use case.
 * D12 (CODEBASE_ANALYSIS_2026-10-03)
 */
describe("a description edit does not hand the plan's text to the parser (gap b)", () => {
  async function editDescription(logId: string, text: { prescribedMainWorkout?: string; prescribedAccessory?: string }) {
    const payload = updateWorkoutRouteSchema.parse(text);
    await updateWorkoutUseCase({ userId: ATHLETE, workoutId: logId, payload });
  }

  /** What each bulk text-to-sets path makes of the athlete's logs. */
  async function bulkParse() {
    const unstructured = await storage.workouts.getWorkoutsWithoutExerciseSets(ATHLETE);
    const reparsed = await batchReparseWorkouts(ATHLETE);
    const backfill = await runAssistedMigrationBackfill(ATHLETE);
    return {
      unstructured: unstructured.map((workout) => workout.id),
      reparsed: reparsed.total,
      queued: backfill.queued,
      parsedTexts: parseExercisesFromText.mock.calls.map(([text]) => String(text).trim()),
    };
  }

  it("while the link stands: a 'Weight Training' day's prescribed squat is not parsed in as lifted", async () => {
    const day = await seedSession("Strength", SQUAT_TEXT, [BACK_SQUAT]);
    const log = await link(day, WEIGHT_TRAINING);

    await editDescription(log.id, {
      prescribedMainWorkout: "Squat 3x5 @ 100 kg, felt heavy",
      prescribedAccessory: "Core: 2x20 sit-ups",
    });

    const [edited] = await db.select().from(workoutLogs).where(eq(workoutLogs.id, log.id));
    expect(edited).toMatchObject({
      source: "strava",
      deviceLinkSource: "auto",
      mainWorkout: SQUAT_TEXT,
      prescribedMainWorkout: "Squat 3x5 @ 100 kg, felt heavy",
      prescribedAccessory: "Core: 2x20 sit-ups",
    });
    expect(await setsOn({ workoutLogId: log.id })).toEqual([]);

    expect(await bulkParse()).toEqual({ unstructured: [], reparsed: 0, queued: 0, parsedTexts: [] });
    expect(await setsOn({ workoutLogId: log.id })).toEqual([]);
  });

  it("after unlink: the adopted log's prescribed 8 km tempo is not parsed in as run", async () => {
    const day = await seedSession("Tempo run", TEMPO_TEXT, [EIGHT_KM]);
    const log = await link(day, SHORT_RUN);
    await editDescription(log.id, { prescribedMainWorkout: "6 km easy, legs heavy" });

    // The edit makes the log the athlete's: unlink keeps it, minus the
    // recording's set, as a set-less manual log whose main_workout is the plan's.
    const { log: adopted } = await unlink(log.id);
    expect(adopted).toMatchObject({
      source: "manual",
      deviceLinkSource: null,
      autoLinkRecordingOnly: true,
      mainWorkout: TEMPO_TEXT,
      prescribedMainWorkout: "6 km easy, legs heavy",
    });
    expect(await setsOn({ workoutLogId: log.id })).toEqual([]);

    expect(await bulkParse()).toEqual({ unstructured: [], reparsed: 0, queued: 0, parsedTexts: [] });
    expect(await setsOn({ workoutLogId: log.id })).toEqual([]);
  });

  it("the athlete's own log of the day, its text the plan's, is still parsed", async () => {
    // The skip is scoped by the marker and the standing link, not by the text:
    // a log the athlete typed (or logged as planned) is theirs to parse.
    const own = await seedWorkoutLog(ATHLETE, DAY_DATE, { mainWorkout: SQUAT_TEXT, prescribedMainWorkout: SQUAT_TEXT });

    const result = await bulkParse();

    expect(result.unstructured).toEqual([own.id]);
    expect(result.reparsed).toBe(1);
    expect(result.parsedTexts).toContain(SQUAT_TEXT);
  });
});
