import { exerciseSets, workoutLogs } from "@shared/schema";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockPlanDay } from "../../test/factories";
import type { db } from "../db";
import {
  isCorrectedRecordingSet,
  isUncorrectedRecordingSet,
  releaseStravaActivityInTx,
} from "./deviceActivityLink";
import { updatePlanDayStatus } from "./planService";

/**
 * D12 (CODEBASE_ANALYSIS_2026-10-03): a log an auto link created holds none of
 * the day's prescription, so "Reopen workout" folds it onto the day per
 * exercise: a prescribed exercise the athlete logged gives way to their sets,
 * in its place in the day's order; every other prescribed set stays; a set
 * that stands for nothing prescribed goes after them all. A running set the
 * athlete typed stands for no prescribed run, linked still or unlinked,
 * whatever the recording was: only the recording's set they corrected does.
 * The log is known by `autoLinkRecordingOnly`, which outlives an unlink. A pre-D12 copy of the prescription (no marker), a marked
 * log filled from the plan, and the athlete's own log replace the day's sets
 * outright. The rest of the fold is covered in planService.test.ts, and
 * against real Postgres in deviceActivityLink.recordingSet.integration.test.ts.
 */

const DAY_ID = "day-1";
const USER_ID = "user-1";

const { transactionMock } = vi.hoisted(() => ({ transactionMock: vi.fn<typeof db.transaction>() }));
vi.mock("../db", () => ({ db: { transaction: transactionMock } }));
vi.mock("../storage", () => ({
  storage: { plans: {}, users: { getUser: vi.fn().mockResolvedValue(undefined) } },
}));
vi.mock("../storage/planSlot", () => ({ planSlotForMove: vi.fn().mockResolvedValue({}) }));
vi.mock("./planDayMoves", () => ({ recordPlanDayMove: vi.fn() }));
vi.mock("./autoCoachQueue", () => ({ enqueueAutoCoachInBackground: vi.fn() }));
vi.mock("./analyticsRouteCache", () => ({ invalidateAnalyticsCachesForUser: vi.fn() }));
// Which set an auto link synthesised, and which the athlete corrected, is
// covered in deviceActivityLink.test.ts; here none is, unless a test says
// otherwise.
vi.mock("./deviceActivityLink", () => ({
  releaseStravaActivityInTx: vi.fn(),
  stripStravaActivityLabel: vi.fn(),
  isUncorrectedRecordingSet: vi.fn(() => false),
  isCorrectedRecordingSet: vi.fn(() => false),
}));

/** The recording's set the athlete corrected is `set`, and no other. */
function givenCorrectedRecordingSet(set: Record<string, unknown>): void {
  vi.mocked(isCorrectedRecordingSet).mockImplementation((_log, candidate) =>
    Object.is(candidate, set),
  );
}

/** A log an auto link created since D12, the link still standing. */
const AUTO_LOG = {
  id: "log-auto",
  focus: "Tempo run",
  mainWorkout: "8 km tempo",
  accessory: null,
  notes: "Strava: Morning Run",
  source: "strava",
  stravaActivityId: "9001",
  deviceLinkSource: "auto",
  autoLinkRecordingOnly: true,
};

/** The same log after unlink adopted it: the link columns cleared, the marker kept. */
const UNLINKED_AUTO_LOG = {
  ...AUTO_LOG,
  notes: null,
  source: "manual",
  stravaActivityId: null,
  deviceLinkSource: null,
};

/** A log an auto link created before D12, from a copy of the prescription: no marker. */
const PRE_D12_AUTO_LOG = { ...AUTO_LOG, autoLinkRecordingOnly: false };

const OWN_LOG = {
  ...AUTO_LOG,
  id: "log-own",
  source: "manual",
  stravaActivityId: null,
  deviceLinkSource: null,
  autoLinkRecordingOnly: false,
};

function loggedSet(id: string, setNumber: number, sortOrder: number, workoutLogId = AUTO_LOG.id) {
  return {
    id,
    workoutLogId,
    planDayId: null,
    version: 1,
    exerciseName: "strides",
    setNumber,
    reps: 6,
    sortOrder,
  };
}

interface Prescribed {
  id: string;
  exerciseName: string;
  customLabel?: string | null;
  sortOrder: number | null;
}

/** A day's prescription, one set per exercise name, at sort orders 0, 1, 2, ... */
function prescription(...exerciseNames: string[]): Prescribed[] {
  return exerciseNames.map((exerciseName, sortOrder) => ({
    id: `p${sortOrder}`,
    exerciseName,
    sortOrder,
  }));
}

/** The day's prescription: a tempo run in four sets, sort orders 0 to 3. */
const TEMPO_PRESCRIPTION = prescription("tempo_run", "tempo_run", "tempo_run", "tempo_run");

/** A HYROX-style day: 1 km runs between wall-ball sets. */
const MIXED_PRESCRIPTION = prescription("run", "wall_balls", "run", "wall_balls");

/**
 * A tx for reopening a completed day: the locked status read, the linked-log
 * read (`log`), its sets (`sets`) and, for a log an auto link created with
 * sets on it, the read of the day's prescribed sets (`prescribed`).
 */
function arrangeReopen(
  log: Record<string, unknown>,
  sets: Record<string, unknown>[],
  prescribed: Prescribed[] = TEMPO_PRESCRIPTION,
) {
  const selects = [
    {
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            for: () =>
              Promise.resolve([
                {
                  planId: "plan-1",
                  status: "completed",
                  scheduledDate: "2026-10-01",
                  recovery: null,
                },
              ]),
          }),
        }),
      }),
    },
    { from: () => ({ where: () => ({ orderBy: () => Promise.resolve([log]) }) }) },
    { from: () => ({ where: () => ({ orderBy: () => Promise.resolve(sets) }) }) },
    { from: () => ({ where: () => ({ orderBy: () => Promise.resolve(prescribed) }) }) },
  ];
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const deletes: { table: unknown; where: SQL }[] = [];
  const updates: { table: unknown; patch: Record<string, unknown>; where: SQL }[] = [];
  const tx = {
    select: vi.fn(() => selects.shift()),
    delete: vi.fn((table: unknown) => ({
      where: (where: SQL) => {
        deletes.push({ table, where });
        return Promise.resolve(undefined);
      },
    })),
    insert: vi.fn(() => ({ values: insertValues })),
    update: vi.fn((table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (where: SQL) => {
          updates.push({ table, patch, where });
          return { returning: () => Promise.resolve([createMockPlanDay({ id: DAY_ID })]) };
        },
      }),
    })),
  };
  transactionMock.mockImplementation(async (callback) =>
    callback(tx as unknown as Parameters<Parameters<typeof db.transaction>[0]>[0]),
  );
  const insertedRows = () =>
    insertValues.mock.calls[0]?.[0] as Record<string, unknown>[] | undefined;
  /** The ids of the prescribed sets the fold deleted, which it names one by one rather than clearing the day. */
  const deletedPrescribedIds = () =>
    deletes
      .filter((call) => call.table === exerciseSets)
      .flatMap((call) => {
        const query = new PgDialect().sqlToQuery(call.where);
        expect(query.sql).toMatch(/^"exercise_sets"\."id" in \(/);
        return query.params;
      });
  /** Whether the fold cleared the day's sets outright, as it does for a log that holds the whole session. */
  const clearedTheDay = () =>
    deletes.some((call) => {
      if (call.table !== exerciseSets) return false;
      const query = new PgDialect().sqlToQuery(call.where);
      return query.sql === '"exercise_sets"."plan_day_id" = $1' && query.params[0] === DAY_ID;
    });
  /** The prescribed sets the fold moved to make room, as [id, new sortOrder]. */
  const movedPrescribedSets = () =>
    updates
      .filter((call) => call.table === exerciseSets)
      .map((call) => [new PgDialect().sqlToQuery(call.where).params[0], call.patch.sortOrder]);
  return { tx, insertedRows, deletedPrescribedIds, movedPrescribedSets, clearedTheDay };
}

const reopen = () => updatePlanDayStatus(DAY_ID, { status: "planned" }, USER_ID);

describe("reopening a day an auto link completed (D12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isUncorrectedRecordingSet).mockImplementation(() => false);
    vi.mocked(isCorrectedRecordingSet).mockImplementation(() => false);
  });

  it("keeps the prescribed sets and appends the athlete's added sets after them", async () => {
    const { tx, insertedRows, movedPrescribedSets } = arrangeReopen(AUTO_LOG, [
      loggedSet("set-a", 1, 1),
      loggedSet("set-b", 2, 2),
    ]);

    await reopen();

    // Only the log goes; the day's own sets stay, where they were.
    expect(tx.delete).not.toHaveBeenCalledWith(exerciseSets);
    expect(tx.delete).toHaveBeenCalledWith(workoutLogs);
    expect(movedPrescribedSets()).toEqual([]);
    expect(insertedRows()).toEqual([
      expect.objectContaining({
        exerciseName: "strides",
        setNumber: 1,
        sortOrder: 4,
        planDayId: DAY_ID,
        workoutLogId: null,
      }),
      expect.objectContaining({
        exerciseName: "strides",
        setNumber: 2,
        sortOrder: 5,
        planDayId: DAY_ID,
        workoutLogId: null,
      }),
    ]);
  });

  it("appends only what the athlete added, not the set the link synthesised from the recording", async () => {
    const recordingSet = {
      ...loggedSet("set-recording", 1, 0),
      exerciseName: "run",
      reps: null,
      distance: 6100,
      notes: null,
    };
    vi.mocked(isUncorrectedRecordingSet).mockImplementation((_log, set) =>
      Object.is(set, recordingSet),
    );
    const { tx, insertedRows } = arrangeReopen(
      AUTO_LOG,
      [recordingSet, loggedSet("set-a", 1, 1)],
      prescription("tempo_run"),
    );

    await reopen();

    expect(tx.delete).not.toHaveBeenCalledWith(exerciseSets);
    expect(insertedRows()?.map((row) => [row.exerciseName, row.sortOrder])).toEqual([
      ["strides", 1],
    ]);
    expect(releaseStravaActivityInTx).toHaveBeenCalledWith(tx, AUTO_LOG, USER_ID, "km", null);
  });

  it("reopening a run day whose recorded run the athlete only annotated keeps the 8 km", async () => {
    // D12 (CODEBASE_ANALYSIS_2026-10-03): a note bumps the version but leaves
    // both of the watch's numbers, so the set is still the recording's
    // (isUncorrectedRecordingSet), as unlink reads it. Read as one only while
    // nobody had saved it, it was folded onto the day after the 8 km while the
    // release wrote the 6.1 km on the recording's row as well: completing the
    // day again counted the run twice. It leaves with the recording, note and all.
    const annotated = {
      ...loggedSet("set-recording", 1, 0),
      exerciseName: "run",
      reps: null,
      distance: 6100,
      version: 2,
      notes: "windy",
    };
    vi.mocked(isUncorrectedRecordingSet).mockImplementation((_log, set) =>
      Object.is(set, annotated),
    );
    const { tx, insertedRows } = arrangeReopen(AUTO_LOG, [annotated], prescription("tempo_run"));

    await reopen();

    expect(tx.delete).not.toHaveBeenCalledWith(exerciseSets);
    expect(insertedRows()).toBeUndefined();
    expect(releaseStravaActivityInTx).toHaveBeenCalledWith(tx, AUTO_LOG, USER_ID, "km", "windy");
  });

  it("leaves the prescribed sets untouched when nothing of the athlete's is on the log", async () => {
    const { tx, insertedRows } = arrangeReopen(AUTO_LOG, []);

    await reopen();

    expect(tx.delete).not.toHaveBeenCalledWith(exerciseSets);
    expect(insertedRows()).toBeUndefined();
    // No read of the day's prescription either: there is nothing to fold.
    expect(tx.select).toHaveBeenCalledTimes(3);
  });

  it("still replaces the prescribed sets with the sets of the athlete's own log, in their own order", async () => {
    // Their own log began as a copy of the prescription, so its sets are their
    // edited version of it.
    const { tx, insertedRows } = arrangeReopen(OWN_LOG, [loggedSet("set-a", 1, 0, OWN_LOG.id)]);

    await reopen();

    expect(tx.delete).toHaveBeenCalledWith(exerciseSets);
    expect(tx.select).toHaveBeenCalledTimes(3);
    expect(insertedRows()).toEqual([
      expect.objectContaining({
        exerciseName: "strides",
        sortOrder: 0,
        planDayId: DAY_ID,
        workoutLogId: null,
      }),
    ]);
  });

  it("replaces the prescription with an auto link's copy of it from before D12, rather than doubling it", async () => {
    // Before D12 an auto link copied the prescription in, each set with its
    // planned* snapshot. Appended, the day held its 3x5 twice.
    const copied = [1, 2, 3].map((setNumber) => ({
      ...loggedSet(`set-copy-${setNumber}`, setNumber, setNumber - 1),
      exerciseName: "back_squat",
      reps: 5,
      weight: 110,
      plannedReps: 5,
      plannedWeight: 110,
    }));
    const { tx, insertedRows } = arrangeReopen(
      PRE_D12_AUTO_LOG,
      copied,
      prescription("back_squat", "back_squat", "back_squat"),
    );

    await reopen();

    expect(tx.delete).toHaveBeenCalledWith(exerciseSets);
    expect(insertedRows()?.map((row) => [row.exerciseName, row.weight, row.sortOrder])).toEqual([
      ["back_squat", 110, 0],
      ["back_squat", 110, 1],
      ["back_squat", 110, 2],
    ]);
  });

  it("replaces the day with a pre-D12 log the athlete retyped, as it always did: it began as the whole session", async () => {
    // No marker: the link copied the prescription in. The athlete swapped the
    // copied squats for the 3x5 they did and dropped the rest, deliberately.
    const typed = { ...loggedSet("set-typed", 1, 0), exerciseName: "back_squat", reps: 5, weight: 100 };
    const { insertedRows, clearedTheDay } = arrangeReopen(
      PRE_D12_AUTO_LOG,
      [typed],
      prescription("back_squat", "deadlift"),
    );

    await reopen();

    // The deadlift goes too: the whole day is the log's.
    expect(clearedTheDay()).toBe(true);
    expect(insertedRows()?.map((row) => [row.exerciseName, row.sortOrder])).toEqual([
      ["back_squat", 0],
    ]);
  });

  it("replaces the day with a marked log the athlete filled from the plan: it holds the prescription now", async () => {
    // "Seed from plan" copies each prescribed set in with its planned*
    // snapshot; the athlete then deleted the deadlift they skipped.
    const seeded = {
      ...loggedSet("set-seeded", 1, 0),
      exerciseName: "back_squat",
      reps: 5,
      weight: 110,
      plannedReps: 5,
      plannedWeight: 110,
    };
    const { insertedRows, clearedTheDay } = arrangeReopen(
      UNLINKED_AUTO_LOG,
      [seeded],
      prescription("back_squat", "deadlift"),
    );

    await reopen();

    expect(clearedTheDay()).toBe(true);
    expect(insertedRows()?.map((row) => [row.exerciseName, row.sortOrder])).toEqual([
      ["back_squat", 0],
    ]);
  });

  it("replaces rather than appends a copied set whose exercise the day no longer prescribes", async () => {
    // The coach swapped the day to front squats after the link copied the
    // back squats in; the planned* snapshot still marks the copy.
    const copied = {
      ...loggedSet("set-copy", 1, 0),
      exerciseName: "back_squat",
      reps: 5,
      weight: 110,
      plannedReps: 5,
    };
    const { tx, insertedRows } = arrangeReopen(
      PRE_D12_AUTO_LOG,
      [copied],
      prescription("front_squat"),
    );

    await reopen();

    expect(tx.delete).toHaveBeenCalledWith(exerciseSets);
    expect(insertedRows()?.map((row) => [row.exerciseName, row.sortOrder])).toEqual([
      ["back_squat", 0],
    ]);
  });

  it("replaces the prescribed lifts with the lifts the athlete typed on a 'Weight Training' log", async () => {
    // The link wrote no set; the 3x5 at 100 kg is what they did instead of 110.
    const typed = [1, 2, 3].map((setNumber) => ({
      ...loggedSet(`set-typed-${setNumber}`, setNumber, setNumber - 1),
      exerciseName: "back_squat",
      reps: 5,
      weight: 100,
    }));
    const { insertedRows, deletedPrescribedIds } = arrangeReopen(
      AUTO_LOG,
      typed,
      prescription("back_squat", "back_squat", "back_squat"),
    );

    await reopen();

    expect(deletedPrescribedIds()).toEqual(["p0", "p1", "p2"]);
    expect(insertedRows()?.map((row) => [row.exerciseName, row.weight, row.sortOrder])).toEqual([
      ["back_squat", 100, 0],
      ["back_squat", 100, 1],
      ["back_squat", 100, 2],
    ]);
  });

  it("replaces the prescription with the recording's set the athlete corrected, rather than adding a second run", async () => {
    // Corrected, so no longer the recording's own set; still the run, even
    // though the prescription files it as a tempo run.
    const corrected = {
      ...loggedSet("set-recording", 1, 0),
      exerciseName: "run",
      reps: null,
      distance: 6000,
      version: 2,
    };
    givenCorrectedRecordingSet(corrected);
    const { insertedRows, deletedPrescribedIds } = arrangeReopen(AUTO_LOG, [
      corrected,
      loggedSet("set-a", 1, 1),
    ]);

    await reopen();

    expect(deletedPrescribedIds()).toEqual(["p0", "p1", "p2", "p3"]);
    expect(
      insertedRows()?.map((row) => [row.exerciseName, row.distance ?? null, row.sortOrder]),
    ).toEqual([
      ["run", 6000, 0],
      ["strides", null, 1],
    ]);
  });

  it("on a mixed day, replaces only the station the athlete logged and keeps the prescribed runs in place", async () => {
    // A Run recording completed a HYROX-style day; the athlete added the one
    // set of wall balls they did. The link never copied the runs in, so their
    // absence from the log is not a deletion.
    const recordingSet = {
      ...loggedSet("set-recording", 1, 0),
      exerciseName: "run",
      reps: null,
      distance: 4100,
    };
    vi.mocked(isUncorrectedRecordingSet).mockImplementation((_log, set) =>
      Object.is(set, recordingSet),
    );
    const wallBalls = { ...loggedSet("set-wb", 1, 1), exerciseName: "wall_balls", reps: 25 };
    const { insertedRows, deletedPrescribedIds, movedPrescribedSets } = arrangeReopen(
      AUTO_LOG,
      [recordingSet, wallBalls],
      MIXED_PRESCRIPTION,
    );

    await reopen();

    // Both prescribed wall-ball sets give way to the one they logged, in the
    // first one's place; the runs at 0 and 2 are neither deleted nor moved.
    expect(deletedPrescribedIds()).toEqual(["p1", "p3"]);
    expect(movedPrescribedSets()).toEqual([]);
    expect(insertedRows()?.map((row) => [row.exerciseName, row.reps, row.sortOrder])).toEqual([
      ["wall_balls", 25, 1],
    ]);
  });

  it("on a mixed day, puts the recorded run the athlete corrected in place of the prescribed runs only", async () => {
    const corrected = {
      ...loggedSet("set-recording", 1, 0),
      exerciseName: "run",
      reps: null,
      distance: 2100,
      version: 2,
    };
    givenCorrectedRecordingSet(corrected);
    const { insertedRows, deletedPrescribedIds, movedPrescribedSets } = arrangeReopen(
      AUTO_LOG,
      [corrected],
      MIXED_PRESCRIPTION,
    );

    await reopen();

    expect(deletedPrescribedIds()).toEqual(["p0", "p2"]);
    expect(movedPrescribedSets()).toEqual([]);
    expect(insertedRows()?.map((row) => [row.exerciseName, row.distance, row.sortOrder])).toEqual([
      ["run", 2100, 0],
    ]);
  });

  it("appends strides typed as a run after the 8 km while the recorded run is untouched", async () => {
    // Filed under the catalogue's plain "run", the strides matched the
    // prescribed 8 km by name and deleted it. The recording measured the 8 km.
    const recordingSet = {
      ...loggedSet("set-recording", 1, 0),
      exerciseName: "run",
      reps: null,
      distance: 6100,
    };
    vi.mocked(isUncorrectedRecordingSet).mockImplementation((_log, set) =>
      Object.is(set, recordingSet),
    );
    const strides = { ...loggedSet("set-strides", 2, 1), exerciseName: "run", distance: 100 };
    const { tx, insertedRows, movedPrescribedSets } = arrangeReopen(
      AUTO_LOG,
      [recordingSet, strides],
      prescription("run"),
    );

    await reopen();

    // The prescribed 8 km (p0) is neither deleted nor moved; the strides follow it.
    expect(tx.delete).not.toHaveBeenCalledWith(exerciseSets);
    expect(movedPrescribedSets()).toEqual([]);
    expect(
      insertedRows()?.map((row) => [row.exerciseName, row.distance, row.reps, row.sortOrder]),
    ).toEqual([["run", 100, 6, 1]]);
  });

  it("on a mixed day, appends a cool-down run and keeps every prescribed run while the recorded run is untouched", async () => {
    const recordingSet = {
      ...loggedSet("set-recording", 1, 0),
      exerciseName: "run",
      reps: null,
      distance: 4100,
    };
    vi.mocked(isUncorrectedRecordingSet).mockImplementation((_log, set) =>
      Object.is(set, recordingSet),
    );
    const wallBalls = { ...loggedSet("set-wb", 1, 1), exerciseName: "wall_balls", reps: 25 };
    const coolDown = {
      ...loggedSet("set-cool-down", 2, 2),
      exerciseName: "run",
      reps: null,
      distance: 1500,
    };
    const { insertedRows, deletedPrescribedIds, movedPrescribedSets } = arrangeReopen(
      AUTO_LOG,
      [recordingSet, wallBalls, coolDown],
      MIXED_PRESCRIPTION,
    );

    await reopen();

    // The station still follows the per-exercise rule; the runs at 0 and 2
    // stay where they are, and the cool-down goes after them.
    expect(deletedPrescribedIds()).toEqual(["p1", "p3"]);
    expect(movedPrescribedSets()).toEqual([]);
    expect(
      insertedRows()?.map((row) => [
        row.exerciseName,
        row.reps,
        row.distance ?? null,
        row.sortOrder,
      ]),
    ).toEqual([
      ["wall_balls", 25, null, 1],
      ["run", null, 1500, 3],
    ]);
  });

  it("keeps the 8 km and appends a run the athlete typed in place of the recording's set they deleted", async () => {
    // Version 1 and neither of the recording's numbers: not the recording's
    // set, uncorrected or corrected, so nothing says it is their 8 km.
    const typed = {
      ...loggedSet("set-typed", 1, 0),
      exerciseName: "run",
      reps: null,
      distance: 600,
    };
    const { tx, insertedRows, movedPrescribedSets } = arrangeReopen(
      AUTO_LOG,
      [typed],
      prescription("run"),
    );

    await reopen();

    expect(tx.delete).not.toHaveBeenCalledWith(exerciseSets);
    expect(movedPrescribedSets()).toEqual([]);
    expect(insertedRows()?.map((row) => [row.exerciseName, row.distance, row.sortOrder])).toEqual([
      ["run", 600, 1],
    ]);
  });

  it("keeps every prescribed run of a HYROX day a 'Workout' recording completed, and appends the cool-down", async () => {
    // A "Workout" recording writes no set, so there is no recorded run to
    // tell the athlete's runs by. Matched by name, the one cool-down run
    // deleted all four prescribed 1 km runs.
    const coolDown = {
      ...loggedSet("set-cool-down", 1, 0),
      exerciseName: "run",
      reps: null,
      distance: 1500,
    };
    const { tx, insertedRows, movedPrescribedSets } = arrangeReopen(
      AUTO_LOG,
      [coolDown],
      prescription("run", "wall_balls", "run", "wall_balls", "run", "wall_balls", "run", "wall_balls"),
    );

    await reopen();

    expect(tx.delete).not.toHaveBeenCalledWith(exerciseSets);
    expect(movedPrescribedSets()).toEqual([]);
    expect(insertedRows()?.map((row) => [row.exerciseName, row.distance, row.sortOrder])).toEqual([
      ["run", 1500, 8],
    ]);
  });

  it("keeps the prescribed run of a brick day a Ride recording completed, and appends the run the athlete added", async () => {
    const recordingSet = {
      ...loggedSet("set-recording", 1, 0),
      exerciseName: "cycling",
      reps: null,
      distance: 40000,
    };
    vi.mocked(isUncorrectedRecordingSet).mockImplementation((_log, set) =>
      Object.is(set, recordingSet),
    );
    const run = { ...loggedSet("set-run", 1, 1), exerciseName: "run", reps: null, distance: 2000 };
    const { tx, insertedRows } = arrangeReopen(
      AUTO_LOG,
      [recordingSet, run],
      prescription("cycling", "run"),
    );

    await reopen();

    // The same as after unlink: the 5 km stays, the 2 km follows it.
    expect(tx.delete).not.toHaveBeenCalledWith(exerciseSets);
    expect(insertedRows()?.map((row) => [row.exerciseName, row.distance, row.sortOrder])).toEqual([
      ["run", 2000, 2],
    ]);
  });

  it("lets only the corrected recording set stand for the prescribed run, not a run typed beside it", async () => {
    const corrected = {
      ...loggedSet("set-recording", 1, 0),
      exerciseName: "run",
      reps: null,
      distance: 8000,
      version: 2,
    };
    givenCorrectedRecordingSet(corrected);
    const strides = { ...loggedSet("set-strides", 2, 1), exerciseName: "run", distance: 100 };
    const { insertedRows, deletedPrescribedIds } = arrangeReopen(
      AUTO_LOG,
      [corrected, strides],
      prescription("tempo_run"),
    );

    await reopen();

    expect(deletedPrescribedIds()).toEqual(["p0"]);
    expect(insertedRows()?.map((row) => [row.exerciseName, row.distance, row.sortOrder])).toEqual([
      ["run", 8000, 0],
      ["run", 100, 1],
    ]);
  });

  it("tells custom exercises apart by their label", async () => {
    const strides = {
      ...loggedSet("set-strides", 1, 0),
      exerciseName: "custom",
      customLabel: "Strides",
    };
    const { tx, insertedRows } = arrangeReopen(
      AUTO_LOG,
      [strides],
      [{ id: "p0", exerciseName: "custom", customLabel: "Sled drag", sortOrder: 0 }],
    );

    await reopen();

    // Another custom exercise: added after the sled drag, which stays.
    expect(tx.delete).not.toHaveBeenCalledWith(exerciseSets);
    expect(insertedRows()?.map((row) => [row.customLabel, row.sortOrder])).toEqual([
      ["Strides", 1],
    ]);
  });

  it("replaces a custom exercise the athlete logged under the same label, whatever its case", async () => {
    const sledDrag = {
      ...loggedSet("set-drag", 1, 0),
      exerciseName: "custom",
      customLabel: "sled drag ",
    };
    const { insertedRows, deletedPrescribedIds } = arrangeReopen(
      AUTO_LOG,
      [sledDrag],
      [
        { id: "p0", exerciseName: "custom", customLabel: "Sled drag", sortOrder: 0 },
        { id: "p1", exerciseName: "custom", customLabel: "Strides", sortOrder: 1 },
      ],
    );

    await reopen();

    expect(deletedPrescribedIds()).toEqual(["p0"]);
    expect(insertedRows()?.map((row) => [row.customLabel, row.sortOrder])).toEqual([
      ["sled drag ", 0],
    ]);
  });

  it("moves a kept prescribed set back only when the athlete's sets before it need its place", async () => {
    const wallBalls = [1, 2, 3].map((setNumber) => ({
      ...loggedSet(`set-wb-${setNumber}`, setNumber, setNumber - 1),
      exerciseName: "wall_balls",
      reps: 20,
    }));
    const { insertedRows, deletedPrescribedIds, movedPrescribedSets } = arrangeReopen(
      AUTO_LOG,
      wallBalls,
      prescription("wall_balls", "run"),
    );

    await reopen();

    expect(deletedPrescribedIds()).toEqual(["p0"]);
    expect(insertedRows()?.map((row) => [row.exerciseName, row.setNumber, row.sortOrder])).toEqual([
      ["wall_balls", 1, 0],
      ["wall_balls", 2, 1],
      ["wall_balls", 3, 2],
    ]);
    // The run was at 1; three sets of wall balls now come before it.
    expect(movedPrescribedSets()).toEqual([["p1", 3]]);
  });
});

/**
 * After unlink the log is the athlete's (`source` manual, link columns cleared)
 * and only `autoLinkRecordingOnly` says it never held the prescription. The
 * recording and its set are gone, so nothing tells a run they typed as their
 * version of the prescribed one from strides they added: running sets are
 * additions, and the prescribed running stays. D12 (CODEBASE_ANALYSIS_2026-10-03)
 */
describe("reopening a day whose auto-linked log was unlinked (D12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isUncorrectedRecordingSet).mockImplementation(() => false);
    vi.mocked(isCorrectedRecordingSet).mockImplementation(() => false);
  });

  it("keeps the 8 km and appends the strides the athlete added", async () => {
    const { tx, insertedRows, movedPrescribedSets } = arrangeReopen(
      UNLINKED_AUTO_LOG,
      [loggedSet("set-a", 1, 1)],
      prescription("run"),
    );

    await reopen();

    expect(tx.delete).not.toHaveBeenCalledWith(exerciseSets);
    expect(movedPrescribedSets()).toEqual([]);
    expect(insertedRows()?.map((row) => [row.exerciseName, row.sortOrder])).toEqual([
      ["strides", 1],
    ]);
    // There is no recording left to read a set off.
    expect(isUncorrectedRecordingSet).not.toHaveBeenCalled();
    expect(isCorrectedRecordingSet).not.toHaveBeenCalled();
  });

  it("leaves the prescription untouched when the log holds no sets (an RPE or a note the only edit)", async () => {
    const { tx, insertedRows } = arrangeReopen(UNLINKED_AUTO_LOG, [], prescription("back_squat"));

    await reopen();

    expect(tx.delete).not.toHaveBeenCalledWith(exerciseSets);
    expect(insertedRows()).toBeUndefined();
    expect(tx.select).toHaveBeenCalledTimes(3);
  });

  it("appends strides typed as a run after the 8 km instead of putting them in its place", async () => {
    const strides = { ...loggedSet("set-strides", 1, 1), exerciseName: "run", distance: 100 };
    const { tx, insertedRows, movedPrescribedSets } = arrangeReopen(
      UNLINKED_AUTO_LOG,
      [strides],
      prescription("run"),
    );

    await reopen();

    expect(tx.delete).not.toHaveBeenCalledWith(exerciseSets);
    expect(movedPrescribedSets()).toEqual([]);
    expect(
      insertedRows()?.map((row) => [row.exerciseName, row.distance, row.reps, row.sortOrder]),
    ).toEqual([["run", 100, 6, 1]]);
  });

  it("never reads a run left on the log as the prescribed one, even the recording's corrected set", async () => {
    // What a still-linked log names as the recording's corrected set. The
    // recording is gone, and the athlete said it was not this session.
    const corrected = {
      ...loggedSet("set-recording", 1, 0),
      exerciseName: "run",
      reps: null,
      distance: 6000,
      version: 2,
    };
    givenCorrectedRecordingSet(corrected);
    const { tx, insertedRows } = arrangeReopen(
      UNLINKED_AUTO_LOG,
      [corrected],
      prescription("tempo_run", "run"),
    );

    await reopen();

    expect(tx.delete).not.toHaveBeenCalledWith(exerciseSets);
    expect(insertedRows()?.map((row) => [row.exerciseName, row.distance, row.sortOrder])).toEqual([
      ["run", 6000, 2],
    ]);
  });

  it("still puts a lift the athlete logged in place of the prescribed one, and keeps the rest", async () => {
    const squat = { ...loggedSet("set-squat", 1, 0), exerciseName: "back_squat", reps: 5, weight: 100 };
    const { insertedRows, deletedPrescribedIds, movedPrescribedSets } = arrangeReopen(
      UNLINKED_AUTO_LOG,
      [squat],
      prescription("back_squat", "deadlift"),
    );

    await reopen();

    expect(deletedPrescribedIds()).toEqual(["p0"]);
    expect(movedPrescribedSets()).toEqual([]);
    expect(insertedRows()?.map((row) => [row.exerciseName, row.weight, row.sortOrder])).toEqual([
      ["back_squat", 100, 0],
    ]);
  });
});
