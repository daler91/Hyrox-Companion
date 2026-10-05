import {
  addExerciseSetBodySchema,
  exerciseSets,
  patchExerciseSetBodySchema,
  planDays,
  type StravaActivitySummary,
  type StructureBlockInput,
  trainingPlans,
  users,
  workoutLogs,
  workoutStructureBlocks,
  workoutStructureSteps,
} from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../db";
import { storage } from "../storage";
import { seedExerciseSet, seedUser, seedWorkoutLog } from "../storage/__tests__/integrationDb";
import { createMutateExerciseSetUseCase } from "../usecases/workouts/mutateExerciseSet.usecase";
import {
  createLogFromPlanDayWithStravaInTx,
  linkStandaloneDeviceLog,
  pickDeviceMetrics,
  stravaSnapshot,
  unlinkDeviceActivity,
} from "./deviceActivityLink";
import { deviceActivitySetRow } from "./deviceActivitySets";
import { mapStravaActivityToWorkout } from "./stravaMapper";
import { assignWorkoutPlanDay, updateWorkout } from "./workoutService";

/**
 * D12 (CODEBASE_ANALYSIS_2026-10-03), against the real schema: two ways an
 * unlink left the run an auto link recorded on the log it kept, while the
 * released recording got its own copy, so the session counted twice, and
 * what fixing them asked of unlink and relink.
 *
 *  1. The athlete only annotated the recording's set (a note: version 2, both
 *     of the watch's numbers kept). Unlink took off only an untouched
 *     (version 1) set, so the annotated one stayed. A set still holding both
 *     numbers is the recording's, as "Reopen workout" reads it too: it leaves
 *     with the recording, and the note goes onto the released row's set. A
 *     log whose only change was that note (and the adherence snapshot the set
 *     PATCH re-derived) holds nothing of the athlete's and is deleted, rather
 *     than kept empty and still completing the day. A run they labelled or
 *     paced is theirs and stays, every value with it.
 *  2. The athlete moved the log off its plan day, then unlinked. Unlink knew a
 *     link-created log by its plan day alone, so this one unwound like the
 *     athlete's own: still a "strava" log, the recording's set kept. The
 *     auto link's marker says what the log is with no day: deleted when
 *     unedited, adopted as "manual" without the recording's set when edited.
 *  3. Linking the released recording again, the second tap of fixing a wrong
 *     match, deleted its row and the note with it. The note goes onto the
 *     target's notes.
 *  4. The athlete built a structure on the log. The auto link writes none,
 *     but unlink read a block as an edit only once it was scored, so it
 *     deleted the log as unedited and the structure with it, with nothing
 *     in the recycle bin. Any block on an auto link's log is the athlete's.
 *
 * Set edits go through the set routes' use case, so the adherence snapshot
 * is re-derived as it is in the app. Cleans up only its own athlete rather
 * than resetting the whole database.
 */

const ATHLETE = "unlink-edges-athlete";
const DAY_DATE = "2026-06-01";
const NEXT_DATE = "2026-06-02";

/** The set routes' use case on the real storage, as workoutsCrud.routes wires it. */
const setRoutes = createMutateExerciseSetUseCase({
  updateSet: (owner, setId, body, userId) => storage.workouts.mutateExerciseSetUpdate(owner, setId, body, userId),
  addSet: (owner, body, userId) => storage.workouts.mutateExerciseSetAdd(owner, body, userId),
  deleteSet: (owner, setId, userId) => storage.workouts.mutateExerciseSetDelete(owner, setId, userId),
  getUnitPreferences: () => Promise.resolve({ weightUnit: "kg", distanceUnit: "km" }),
});

/** PATCH /workouts/:id/sets/:setId, as the route parses it. */
function patchSet(logId: string, setId: string, body: unknown) {
  const parsed = patchExerciseSetBodySchema.parse(body);
  return setRoutes.updateSet({ kind: "workoutLog", ownerId: logId }, setId, parsed, ATHLETE);
}

/** POST /workouts/:id/sets, as the route parses it. */
function addSet(logId: string, body: unknown) {
  const parsed = addExerciseSetBodySchema.parse(body);
  return setRoutes.addSet({ kind: "workoutLog", ownerId: logId }, parsed, ATHLETE);
}

const SHORT_RUN: StravaActivitySummary = {
  id: 781001,
  name: "Morning Run",
  type: "Run",
  sport_type: "Run",
  start_date: `${DAY_DATE}T05:30:00Z`,
  start_date_local: `${DAY_DATE}T06:30:00Z`,
  distance: 6123,
  moving_time: 31 * 60,
  elapsed_time: 32 * 60,
  total_elevation_gain: 20,
  average_speed: 3.3,
  max_speed: 4.1,
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

/** A planned run day of the athlete's plan, with its prescribed run. */
async function runDay(planId: string, scheduledDate: string, focus: string, distance: number) {
  const [day] = await db
    .insert(planDays)
    .values({
      planId,
      weekNumber: 1,
      dayName: scheduledDate === DAY_DATE ? "monday" : "tuesday",
      focus,
      mainWorkout: `${distance / 1000} km`,
      scheduledDate,
      status: "planned",
    })
    .returning();
  await seedExerciseSet({
    planDayId: day.id,
    exerciseName: "run",
    category: "running",
    setNumber: 1,
    distance,
    distanceUnit: "m",
    sortOrder: 0,
  });
  return day;
}

async function athletePlan() {
  const [plan] = await db
    .insert(trainingPlans)
    .values({ userId: ATHLETE, name: "Build", totalWeeks: 4, startDate: DAY_DATE })
    .returning();
  return plan;
}

/** An 8 km tempo day, auto-linked to the 6.1 km the watch recorded. */
async function autoLinkedTempoDay() {
  const plan = await athletePlan();
  const day = await runDay(plan.id, DAY_DATE, "Tempo run", 8000);
  const log = await db.transaction((tx) =>
    createLogFromPlanDayWithStravaInTx(tx, {
      userId: ATHLETE,
      planDay: day,
      raw: SHORT_RUN,
      metrics: pickDeviceMetrics(mapStravaActivityToWorkout(SHORT_RUN, ATHLETE, "km")),
      linkSource: "auto",
      confidence: 0.8,
    }),
  );
  return { plan, day, log };
}

async function recordingSetOf(logId: string) {
  const [set] = await db.select().from(exerciseSets).where(eq(exerciseSets.workoutLogId, logId));
  return set;
}

function unlink(logId: string) {
  return unlinkDeviceActivity({ userId: ATHLETE, logId, distanceUnit: "km" });
}

/** Every run set on the athlete's logs: what the set-derived analytics count. */
async function athleteRuns() {
  return await db
    .select({
      workoutLogId: exerciseSets.workoutLogId,
      distance: exerciseSets.distance,
      notes: exerciseSets.notes,
    })
    .from(exerciseSets)
    .innerJoin(workoutLogs, eq(workoutLogs.id, exerciseSets.workoutLogId))
    .where(and(eq(workoutLogs.userId, ATHLETE), eq(exerciseSets.exerciseName, "run")));
}

/** The athlete's logs on a plan day: what completes it, and what log-level counts see. */
async function logsOnDay(dayId: string) {
  return await db
    .select({ id: workoutLogs.id, source: workoutLogs.source, notes: workoutLogs.notes })
    .from(workoutLogs)
    .where(and(eq(workoutLogs.userId, ATHLETE), eq(workoutLogs.planDayId, dayId)));
}

/** A log's adherence snapshot. */
async function adherenceOf(logId: string) {
  const row = await logRow(logId);
  return {
    plannedSetCount: row.plannedSetCount,
    actualSetCount: row.actualSetCount,
    compliancePct: row.compliancePct,
  };
}

async function logRow(logId: string) {
  const [row] = await db.select().from(workoutLogs).where(eq(workoutLogs.id, logId));
  return row;
}

async function dayStatus(dayId: string) {
  const [row] = await db.select({ status: planDays.status }).from(planDays).where(eq(planDays.id, dayId));
  return row.status;
}

/** One round of a 1 km run, as the structure editor saves a block. */
const ROUNDS_BLOCK: StructureBlockInput = {
  sectionType: "main",
  formatType: "rounds",
  roundCount: 1,
  sequenceOrder: 0,
  sortOrder: 0,
  steps: [
    { stepNumber: 1, stepType: "work", exerciseName: "run", category: "running", targets: { distance: 1000 } },
  ],
};

/**
 * The athlete saves a structure on the log (PATCH /workouts/:id with
 * structureBlocks alone). The log holds the recording's set, so the save
 * derives no set from the step and puts none on it.
 */
async function saveStructure(logId: string): Promise<void> {
  await updateWorkout(logId, {}, undefined, ATHLETE, [ROUNDS_BLOCK]);
  expect(await recordingSetOf(logId)).toMatchObject({ blockId: null, stepNumber: null });
  expect(await structureOf(logId)).toEqual([{ formatType: "rounds", exerciseName: "run" }]);
}

/** A log's structure: each block's format, with the exercise of each of its steps. */
async function structureOf(logId: string) {
  return await db
    .select({ formatType: workoutStructureBlocks.formatType, exerciseName: workoutStructureSteps.exerciseName })
    .from(workoutStructureBlocks)
    .innerJoin(workoutStructureSteps, eq(workoutStructureSteps.blockId, workoutStructureBlocks.id))
    .where(eq(workoutStructureBlocks.workoutLogId, logId));
}

beforeEach(async () => {
  await removeAthlete();
  await seedUser(ATHLETE);
});

afterAll(async () => {
  await removeAthlete();
});

describe("unlinking an auto-linked log whose recorded run the athlete only annotated (item 1)", () => {
  /** The athlete writes a note on the run the watch recorded: version 2, both numbers kept. */
  async function annotatedTempoDay(note = "Windy on the way back") {
    const linked = await autoLinkedTempoDay();
    const recordingSet = await recordingSetOf(linked.log.id);
    const noted = await patchSet(linked.log.id, recordingSet.id, { notes: note });
    expect(noted).toMatchObject({ version: 2, distance: 6123, notes: note });
    // The set PATCH re-derived the snapshot from the watch's run: 1 of 1, "100%".
    expect(await adherenceOf(linked.log.id)).toEqual({ plannedSetCount: 1, actualSetCount: 1, compliancePct: 100 });
    expect(await dayStatus(linked.day.id)).toBe("completed");
    return linked;
  }

  it("deletes a log whose only change is the note: the run counts once, the note goes with it, the day is planned again", async () => {
    const { day, log } = await annotatedTempoDay();

    const { log: kept, standalone } = await unlink(log.id);

    // Kept, it was an empty manual log that still completed the day at 100%,
    // and a second log of the one session.
    expect(kept).toBeNull();
    expect(await logRow(log.id)).toBeUndefined();
    expect(await logsOnDay(day.id)).toEqual([]);
    expect(await dayStatus(day.id)).toBe("planned");
    expect(await athleteRuns()).toEqual([
      { workoutLogId: standalone.id, distance: 6123, notes: "Windy on the way back" },
    ]);
  });

  it("adopts a log the athlete also rated, takes the noted run off it and re-derives its snapshot", async () => {
    const { day, log } = await annotatedTempoDay();
    await db.update(workoutLogs).set({ rpe: 7 }).where(eq(workoutLogs.id, log.id));

    const { log: kept, standalone } = await unlink(log.id);

    expect(kept).toMatchObject({ id: log.id, source: "manual", rpe: 7, autoLinkRecordingOnly: true });
    expect(await athleteRuns()).toEqual([
      { workoutLogId: standalone.id, distance: 6123, notes: "Windy on the way back" },
    ]);
    // No longer 1 of 1 at 100%: the log holds none of the prescribed run.
    expect(await adherenceOf(log.id)).toEqual({ plannedSetCount: 1, actualSetCount: 0, compliancePct: 0 });
    expect(kept).toMatchObject({ actualSetCount: 0, compliancePct: 0 });
    expect(await dayStatus(day.id)).toBe("completed");
  });

  it("re-derives the snapshot of a log the athlete rated and added strides to: the strides, not the run", async () => {
    const { log } = await autoLinkedTempoDay();
    await addSet(log.id, { exerciseName: "strides", category: "running", reps: 6 });
    await db.update(workoutLogs).set({ rpe: 7 }).where(eq(workoutLogs.id, log.id));
    expect(await adherenceOf(log.id)).toEqual({ plannedSetCount: 1, actualSetCount: 2, compliancePct: 100 });

    const { standalone } = await unlink(log.id);

    expect(await adherenceOf(log.id)).toEqual({ plannedSetCount: 1, actualSetCount: 1, compliancePct: 0 });
    const kept = await db
      .select({ exerciseName: exerciseSets.exerciseName })
      .from(exerciseSets)
      .where(eq(exerciseSets.workoutLogId, log.id));
    expect(kept).toEqual([{ exerciseName: "strides" }]);
    expect(await athleteRuns()).toEqual([{ workoutLogId: standalone.id, distance: 6123, notes: null }]);
  });

  it("leaves a run the athlete corrected on the log they keep, and the recording's row gets the watch's", async () => {
    const { log } = await autoLinkedTempoDay();
    const recordingSet = await recordingSetOf(log.id);
    // They corrected the distance and kept the moving time.
    await patchSet(log.id, recordingSet.id, { distance: 6000, notes: "Watch cut the corner" });

    const { log: kept, standalone } = await unlink(log.id);

    expect(kept).toMatchObject({ id: log.id, source: "manual" });
    const runs = await athleteRuns();
    expect(runs).toHaveLength(2);
    expect(runs).toEqual(
      expect.arrayContaining([
        { workoutLogId: log.id, distance: 6000, notes: "Watch cut the corner" },
        { workoutLogId: standalone.id, distance: 6123, notes: null },
      ]),
    );
  });

  it("keeps a run the athlete labelled and paced on the log, with every value they typed", async () => {
    const { log } = await autoLinkedTempoDay();
    const recordingSet = await recordingSetOf(log.id);
    // The watch's numbers, made part of their session (InlineSetEditor's label fan-out, intensity, pace).
    await patchSet(log.id, recordingSet.id, {
      customLabel: "Tempo with hills",
      intensity: { zone: 3 },
      tempo: { pace: "4:30" },
    });

    const { log: kept, standalone } = await unlink(log.id);

    expect(kept).toMatchObject({ id: log.id, source: "manual" });
    expect(await recordingSetOf(log.id)).toMatchObject({
      distance: 6123,
      customLabel: "Tempo with hills",
      intensity: { zone: 3 },
      tempo: { pace: "4:30" },
    });
    // The recording's row has its own run, as it does for any set of the athlete's.
    expect(await recordingSetOf(standalone.id)).toMatchObject({ distance: 6123, customLabel: null, tempo: null });
  });

  it("hands the note on a run typed with the watch's numbers, in place of the recording's set, to the recording", async () => {
    const { log } = await autoLinkedTempoDay();
    await db.delete(exerciseSets).where(eq(exerciseSets.workoutLogId, log.id));
    await seedExerciseSet({
      workoutLogId: log.id,
      exerciseName: "run",
      category: "running",
      setNumber: 1,
      distance: 6123,
      distanceUnit: "m",
      time: 31,
      notes: "typed by me",
      sortOrder: 0,
    });

    const { log: kept, standalone } = await unlink(log.id);

    // Nothing else of theirs on the log; the note is not lost with it.
    expect(kept).toBeNull();
    expect(await athleteRuns()).toEqual([{ workoutLogId: standalone.id, distance: 6123, notes: "typed by me" }]);
  });
});

describe("unlinking an auto-linked log the athlete moved off its plan day (item 2)", () => {
  async function movedOffItsDay() {
    const linked = await autoLinkedTempoDay();
    const moved = await assignWorkoutPlanDay(linked.log.id, null, ATHLETE);
    expect(moved).toMatchObject({ planDayId: null, source: "strava", autoLinkRecordingOnly: true });
    return linked;
  }

  it("deletes it while unedited, and the run is counted once", async () => {
    const { day, log } = await movedOffItsDay();

    const { log: kept, standalone } = await unlink(log.id);

    expect(kept).toBeNull();
    expect(await logRow(log.id)).toBeUndefined();
    expect(await athleteRuns()).toEqual([{ workoutLogId: standalone.id, distance: 6123, notes: null }]);
    // The move already gave the day back; the unlink re-derives no day.
    expect(await dayStatus(day.id)).toBe("planned");
  });

  it("deletes it when moved back onto its day: the snapshot the move wrote is not an edit", async () => {
    const { day, log } = await movedOffItsDay();
    await assignWorkoutPlanDay(log.id, day.id, ATHLETE);
    expect(await adherenceOf(log.id)).toMatchObject({ plannedSetCount: 1 });

    const { log: kept, standalone } = await unlink(log.id);

    expect(kept).toBeNull();
    expect(await logsOnDay(day.id)).toEqual([]);
    expect(await dayStatus(day.id)).toBe("planned");
    expect(await athleteRuns()).toEqual([{ workoutLogId: standalone.id, distance: 6123, notes: null }]);
  });

  it("adopts it once edited, as a manual log without the recording or its run", async () => {
    const { day, log } = await movedOffItsDay();
    await db.update(workoutLogs).set({ rpe: 7 }).where(eq(workoutLogs.id, log.id));

    const { log: kept, standalone } = await unlink(log.id);

    expect(kept).toMatchObject({
      id: log.id,
      source: "manual",
      planDayId: null,
      rpe: 7,
      stravaActivityId: null,
      deviceLinkSource: null,
      deviceActivity: null,
      autoLinkRecordingOnly: true,
      notes: null,
    });
    expect(await athleteRuns()).toEqual([{ workoutLogId: standalone.id, distance: 6123, notes: null }]);
    expect(await dayStatus(day.id)).toBe("planned");
  });

  it("keeps it as a manual log on a different plan day it was reassigned to: the title is the first day's", async () => {
    // Its focus is still the tempo day's, so it reads as edited (errs that
    // way): kept on the easy day, the run counted once.
    const { plan, day, log } = await autoLinkedTempoDay();
    const easyDay = await runDay(plan.id, NEXT_DATE, "Easy run", 6000);
    await assignWorkoutPlanDay(log.id, easyDay.id, ATHLETE);
    expect(await dayStatus(day.id)).toBe("planned");
    expect(await dayStatus(easyDay.id)).toBe("completed");

    const { log: kept, standalone } = await unlink(log.id);

    expect(kept).toMatchObject({ id: log.id, source: "manual", planDayId: easyDay.id, focus: "Tempo run" });
    expect(await logsOnDay(easyDay.id)).toEqual([{ id: log.id, source: "manual", notes: null }]);
    expect(await dayStatus(easyDay.id)).toBe("completed");
    expect(await athleteRuns()).toEqual([{ workoutLogId: standalone.id, distance: 6123, notes: null }]);
  });
});

describe("linking the released recording again (item 3)", () => {
  /** Annotate the recorded run, then unlink it: the note is on the released row's set. */
  async function annotatedThenUnlinked() {
    const linked = await autoLinkedTempoDay();
    const recordingSet = await recordingSetOf(linked.log.id);
    await patchSet(linked.log.id, recordingSet.id, { notes: "windy" });
    const { standalone } = await unlink(linked.log.id);
    expect(await recordingSetOf(standalone.id)).toMatchObject({ notes: "windy" });
    return { ...linked, standalone };
  }

  function relink(deviceLogId: string, target: { planDayId: string } | { workoutLogId: string }) {
    return linkStandaloneDeviceLog({ userId: ATHLETE, deviceLogId, target });
  }

  it("to the same day: the day's one log carries the note", async () => {
    const { day, standalone } = await annotatedThenUnlinked();

    const linked = await relink(standalone.id, { planDayId: day.id });

    expect(await logRow(standalone.id)).toBeUndefined();
    expect(linked.notes).toBe("Strava: Morning Run\nwindy");
    expect(await logsOnDay(day.id)).toEqual([{ id: linked.id, source: "strava", notes: linked.notes }]);
    expect(await dayStatus(day.id)).toBe("completed");
  });

  it("to another day: that day's log carries the note, and the wrong day is planned again", async () => {
    const { plan, day, standalone } = await annotatedThenUnlinked();
    const nextDay = await runDay(plan.id, NEXT_DATE, "Easy run", 6000);

    const linked = await relink(standalone.id, { planDayId: nextDay.id });

    expect(linked.notes).toBe("Strava: Morning Run\nwindy");
    expect(await dayStatus(nextDay.id)).toBe("completed");
    expect(await logsOnDay(day.id)).toEqual([]);
    expect(await dayStatus(day.id)).toBe("planned");
  });

  /**
   * The 6.1 km run as the sync imports it when no plan day matches (the
   * mapper's row, the recording's snapshot, its synthesised set), with a
   * line the athlete typed on its notes.
   */
  async function standaloneImport(typed: string) {
    const row = mapStravaActivityToWorkout(SHORT_RUN, ATHLETE, "km");
    const [imported] = await db
      .insert(workoutLogs)
      .values({ ...row, notes: `${row.notes ?? ""}\n${typed}`, deviceActivity: stravaSnapshot(SHORT_RUN, []) })
      .returning();
    const set = deviceActivitySetRow(imported, { distanceUnit: "km" });
    if (set) await db.insert(exerciseSets).values(set);
    return imported;
  }

  it("to a day with no log and off it again: the log goes, the day is planned, the run counts once with the note", async () => {
    const plan = await athletePlan();
    const easyDay = await runDay(plan.id, DAY_DATE, "Easy run", 6000);
    const imported = await standaloneImport("felt great");
    const linked = await relink(imported.id, { planDayId: easyDay.id });
    expect(linked.notes).toBe("Strava: Morning Run\nfelt great");
    expect(linked.prescribedNotes).toBe(linked.notes);
    expect(await dayStatus(easyDay.id)).toBe("completed");

    const { log: kept, standalone } = await unlink(linked.id);

    // Read as the athlete's edit, the note kept the log: its copied 6 km
    // stayed as performed next to the released 6.1 km, the day completed.
    expect(kept).toBeNull();
    expect(await logRow(linked.id)).toBeUndefined();
    expect(await logsOnDay(easyDay.id)).toEqual([]);
    expect(await dayStatus(easyDay.id)).toBe("planned");
    expect(await athleteRuns()).toEqual([{ workoutLogId: standalone.id, distance: 6123, notes: "felt great" }]);
  });

  it("to the same day and off it again: the log goes, the day is planned, the run counts once with the note", async () => {
    const { day, standalone } = await annotatedThenUnlinked();
    const linked = await relink(standalone.id, { planDayId: day.id });

    const { log: kept, standalone: released } = await unlink(linked.id);

    expect(kept).toBeNull();
    expect(await logsOnDay(day.id)).toEqual([]);
    expect(await dayStatus(day.id)).toBe("planned");
    expect(await athleteRuns()).toEqual([{ workoutLogId: released.id, distance: 6123, notes: "windy" }]);
  });

  it("to the same day, rated, then off it again: the log is the athlete's and keeps the note", async () => {
    const { day, standalone } = await annotatedThenUnlinked();
    const linked = await relink(standalone.id, { planDayId: day.id });
    await db.update(workoutLogs).set({ rpe: 6 }).where(eq(workoutLogs.id, linked.id));

    const { log: kept, standalone: released } = await unlink(linked.id);

    expect(kept).toMatchObject({ id: linked.id, source: "manual", rpe: 6, notes: "windy" });
    expect(await recordingSetOf(released.id)).toMatchObject({ distance: 6123, notes: null });
    expect(await dayStatus(day.id)).toBe("completed");
  });

  it("to the athlete's own log: the note is added to theirs", async () => {
    const { standalone } = await annotatedThenUnlinked();
    const own = await seedWorkoutLog(ATHLETE, NEXT_DATE, { source: "manual", notes: "Easy day" });

    const linked = await relink(standalone.id, { workoutLogId: own.id });

    expect(linked).toMatchObject({ id: own.id, notes: "Easy day\nwindy", stravaActivityId: String(SHORT_RUN.id) });
  });
});

describe("unlinking an auto-linked log the athlete built a structure on (item 4)", () => {
  /** Kept, adopted as manual, with its structure; the recording's run on the released row only. */
  async function expectKeptWithItsStructure(logId: string, note: string | null = null) {
    const { log: kept, standalone } = await unlink(logId);

    expect(kept).toMatchObject({ id: logId, source: "manual", stravaActivityId: null, autoLinkRecordingOnly: true });
    expect(await structureOf(logId)).toEqual([{ formatType: "rounds", exerciseName: "run" }]);
    expect(await athleteRuns()).toEqual([{ workoutLogId: standalone.id, distance: 6123, notes: note }]);
    return kept;
  }

  it("keeps a log whose only change is the structure", async () => {
    const { day, log } = await autoLinkedTempoDay();
    await saveStructure(log.id);

    await expectKeptWithItsStructure(log.id);

    expect(await logsOnDay(day.id)).toEqual([{ id: log.id, source: "manual", notes: null }]);
    expect(await dayStatus(day.id)).toBe("completed");
  });

  it("keeps it when the run was annotated too, and the note goes with the recording", async () => {
    const { log } = await autoLinkedTempoDay();
    const recordingSet = await recordingSetOf(log.id);
    await patchSet(log.id, recordingSet.id, { notes: "windy" });
    await saveStructure(log.id);

    await expectKeptWithItsStructure(log.id, "windy");
  });

  it("keeps it when it was moved off its day and back, and re-derives its snapshot without the run", async () => {
    const { day, log } = await autoLinkedTempoDay();
    await assignWorkoutPlanDay(log.id, null, ATHLETE);
    await assignWorkoutPlanDay(log.id, day.id, ATHLETE);
    expect(await adherenceOf(log.id)).toEqual({ plannedSetCount: 1, actualSetCount: 1, compliancePct: 100 });
    await saveStructure(log.id);

    const kept = await expectKeptWithItsStructure(log.id);

    expect(kept).toMatchObject({ planDayId: day.id });
    expect(await adherenceOf(log.id)).toEqual({ plannedSetCount: 1, actualSetCount: 0, compliancePct: 0 });
  });
});
