import { exerciseSets, type StravaActivitySummary, type WorkoutLog, workoutLogs } from "@shared/schema";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { syncPlanDayStatusFromWorkouts } from "../storage/planDayStatus";
import {
  hasAthleteEdits,
  isCorrectedRecordingSet,
  isUncorrectedRecordingSet,
  type LinkCreatedLogContents,
  linkStandaloneDeviceLog,
  releaseStravaActivityInTx,
  unlinkDeviceActivity,
} from "./deviceActivityLink";
import { makeWorkoutLog } from "./trainingLoadService.testHelpers";
import { createWorkoutInTx } from "./workoutService";

/**
 * D12 (CODEBASE_ANALYSIS_2026-10-03): two ways unlink left the run an auto
 * link recorded on the log it kept while the released recording got its own
 * copy, so the session counted twice, and what fixing them asked of unlink
 * and relink (deviceActivityLink.test.ts covers the rest of both; the
 * real-Postgres versions are in deviceActivityLink.unlinkEdges.integration.test.ts):
 *
 *  1. a recording set the athlete only annotated (version 2, both of the
 *     watch's numbers kept) stayed on the log as theirs. It leaves with the
 *     recording, its note onto the released row's set; a log whose only
 *     change was that note holds nothing of theirs and is deleted. A set
 *     they labelled or put on a structure step is theirs and stays;
 *  2. a log an auto link created that the athlete moved off its plan day
 *     unwound like their own log, its recording set and all;
 *  3. linking the released recording again deleted its row with the note on
 *     it: the note now goes onto the target's notes. On a plan day with no
 *     log it is part of the notes the created log starts with, not an edit
 *     of it, so unlinking that log again still deletes it and hands the
 *     note back to the recording;
 *  4. a structure the athlete built on an auto link's log was no edit unless
 *     a block was scored, so unlink deleted the log and the structure with
 *     it. The auto link writes none, so any block there is theirs; a manual
 *     link copies the plan's in, so there only a score is.
 */

const dbMocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("../db", () => ({ db: { transaction: dbMocks.transaction } }));
const storageMocks = vi.hoisted(() => ({ getPlanDay: vi.fn(), deleteForLog: vi.fn() }));
vi.mock("../storage", () => ({
  storage: {
    plans: { getPlanDay: storageMocks.getPlanDay },
    sessionStreams: { deleteForLog: storageMocks.deleteForLog },
  },
}));
vi.mock("../storage/planDayStatus", () => ({ syncPlanDayStatusFromWorkouts: vi.fn() }));
vi.mock("./workoutService", () => ({ createWorkoutInTx: vi.fn() }));

const USER = "user-1";

const RAW: StravaActivitySummary = {
  id: 9001,
  name: "Morning Run",
  type: "Run",
  sport_type: "Run",
  start_date: "2026-09-08T11:30:00Z",
  start_date_local: "2026-09-08T06:30:00Z",
  distance: 8100,
  moving_time: 45 * 60,
  elapsed_time: 46 * 60,
  total_elevation_gain: 40,
  average_speed: 3.0,
  max_speed: 4.1,
};

const SNAPSHOT = { provider: "strava" as const, raw: RAW, linkedAt: "2026-09-08T12:00:00Z" };

/** The plan day the fixtures below were linked to. */
const TEMPO_DAY = {
  id: "pd-1",
  planId: "plan-1",
  focus: "Tempo run",
  mainWorkout: "8 km tempo",
  accessory: null,
  notes: "Hold 4:30/km",
  scheduledDate: "2026-09-08",
};

/** The set an auto link synthesises from RAW for a km athlete (deviceActivitySetRow). */
const RECORDING_SET = {
  exerciseName: "run",
  version: 1,
  reps: null,
  plannedReps: null,
  weight: null,
  plannedWeight: null,
  distance: 8100 as number | null,
  plannedDistance: null,
  time: 45,
  plannedTime: null,
  distanceUnit: "m",
};

/** A tempo day's log as an auto link creates it from RAW: the day's text, the recording, its one set. */
function autoLinkLog(overrides: Partial<WorkoutLog> = {}): WorkoutLog {
  return makeWorkoutLog({
    id: "log-2",
    source: "strava",
    date: "2026-09-08",
    focus: "Tempo run",
    mainWorkout: "8 km tempo",
    prescribedMainWorkout: "8 km tempo",
    notes: "Hold 4:30/km\nStrava: Morning Run",
    prescribedNotes: "Hold 4:30/km\nStrava: Morning Run",
    planDayId: "pd-1",
    planId: "plan-1",
    duration: 45,
    distanceMeters: 8100,
    stravaActivityId: "9001",
    deviceLinkSource: "auto",
    deviceLinkConfidence: 0.8,
    autoLinkRecordingOnly: true,
    deviceActivity: { ...SNAPSHOT, filledColumns: ["duration", "distanceMeters"] },
    ...overrides,
  });
}

/** The same log after the athlete moved it off its day (assignWorkoutPlanDay with no day). */
function movedOffItsDay(overrides: Partial<WorkoutLog> = {}): WorkoutLog {
  return autoLinkLog({ planDayId: null, planId: null, ...overrides });
}

/** The standalone row the release inserts, with the recording it was made from, so it gets a set. */
const RELEASED = makeWorkoutLog({
  id: "standalone",
  source: "strava",
  stravaActivityId: "9001",
  deviceActivity: { ...SNAPSHOT, filledColumns: [] },
});

function makeTx() {
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    orderBy: vi.fn().mockResolvedValue([]),
    for: vi.fn(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    returning: vi.fn(),
  };
}

let tx: ReturnType<typeof makeTx>;

/** The condition given to the first `.where()` after `builderMock`'s first call, e.g. a delete's. */
function whereAfter(builderMock: Mock): SQL {
  const [builderOrder] = builderMock.mock.invocationCallOrder;
  const index = tx.where.mock.invocationCallOrder.findIndex((order) => order > builderOrder);
  const call = index === -1 ? undefined : tx.where.mock.calls.at(index);
  if (!call) throw new Error("No .where() followed that builder call.");
  return call[0] as SQL;
}

/** The ids the first DELETE removed. */
function deletedIds(): unknown[] {
  return new PgDialect().sqlToQuery(whereAfter(tx.delete)).params;
}

/** The patch the nth UPDATE wrote (0 = the first). */
function patch(n = 0): Record<string, unknown> {
  const call = tx.set.mock.calls.at(n);
  if (!call) throw new Error(`No update #${n}.`);
  return call[0] as Record<string, unknown>;
}

function firstPatch(): Record<string, unknown> {
  return patch(0);
}

/** The set the release wrote on the standalone row (its second insert, after the row). */
function releasedSet(): Record<string, unknown> {
  const call = tx.values.mock.calls.at(1);
  if (!call) throw new Error("The release wrote no set.");
  return call[0] as Record<string, unknown>;
}

/**
 * Queue the reads unlink makes of a log the link created, in order: the log
 * (FOR UPDATE), its sets, its structure blocks (none unless given); then the
 * sets the kept log is searched for the recording's in.
 */
function givenLinkCreatedLog(
  log: WorkoutLog,
  sets: Parameters<typeof isUncorrectedRecordingSet>[1][],
  blocks: { score: unknown }[] = [],
) {
  tx.for.mockResolvedValue([log]);
  storageMocks.getPlanDay.mockResolvedValue({ focus: log.focus, scheduledDate: log.date });
  tx.where
    .mockReturnValueOnce(tx) // the log select, finished by .for()
    .mockResolvedValueOnce(sets)
    .mockResolvedValueOnce(blocks);
  tx.orderBy.mockResolvedValueOnce(sets.map((set, i) => ({ notes: null, ...set, id: `set-${i}` })));
}

function unlink() {
  return unlinkDeviceActivity({ userId: USER, logId: "log-2", distanceUnit: "km" });
}

beforeEach(() => {
  vi.clearAllMocks();
  tx = makeTx();
  dbMocks.transaction.mockImplementation((callback: (t: typeof tx) => unknown) =>
    Promise.resolve(callback(tx)),
  );
});

describe("unlinking a recording set the athlete only annotated (item 1)", () => {
  it("deletes a log whose only change is a note on the run, and the note goes with the recording", async () => {
    // The set PATCH re-derived an adherence snapshot, too: neither is an edit of the log.
    const log = autoLinkLog({ plannedSetCount: 1, actualSetCount: 1, compliancePct: 100 });
    givenLinkCreatedLog(log, [{ ...RECORDING_SET, version: 2, notes: "Windy on the way back" }]);
    tx.where.mockResolvedValueOnce({ rowCount: 1 }); // the delete
    tx.returning.mockResolvedValueOnce([RELEASED]);

    const result = await unlink();

    // An empty manual log left behind still completed the day, at 100%.
    expect(result.log).toBeNull();
    expect(tx.delete).toHaveBeenCalledTimes(1);
    expect(tx.delete).toHaveBeenCalledWith(workoutLogs);
    expect(syncPlanDayStatusFromWorkouts).toHaveBeenCalledWith("pd-1", USER, tx);
    expect(releasedSet()).toMatchObject({
      workoutLogId: "standalone",
      exerciseName: "run",
      distance: 8100,
      notes: "Windy on the way back",
    });
  });

  it("takes the noted run off a log the athlete also rated, and the note goes with the recording", async () => {
    const log = autoLinkLog({ rpe: 7 });
    givenLinkCreatedLog(log, [{ ...RECORDING_SET, version: 2, notes: "Windy on the way back" }]);
    tx.returning.mockResolvedValueOnce([{ ...log, source: "manual" }]).mockResolvedValueOnce([RELEASED]);

    const result = await unlink();

    // The RPE made the log the athlete's, so it stays, adopted.
    expect(result.log?.source).toBe("manual");
    expect(tx.delete).toHaveBeenCalledWith(exerciseSets);
    expect(deletedIds()).toEqual(["set-0"]);
    expect(releasedSet()).toMatchObject({ exerciseName: "run", distance: 8100, notes: "Windy on the way back" });
  });

  it("keeps a set the athlete corrected on the log, note and all", async () => {
    const log = autoLinkLog();
    givenLinkCreatedLog(log, [{ ...RECORDING_SET, distance: 8000, version: 2, notes: "Watch cut a corner" }]);
    tx.returning.mockResolvedValueOnce([{ ...log, source: "manual" }]).mockResolvedValueOnce([RELEASED]);

    await unlink();

    expect(tx.delete).not.toHaveBeenCalled();
    expect(releasedSet()).toMatchObject({ distance: 8100, notes: null });
  });

  it.each<[string, Partial<Parameters<typeof isUncorrectedRecordingSet>[1]>]>([
    ["labelled", { customLabel: "Tempo with hills" }],
    ["put on a structure step", { blockId: "b-1", stepNumber: 1, stepRole: "work" }],
    ["given an intensity and a pace", { intensity: { zone: 3 }, tempo: { pace: "4:30" } }],
  ])("keeps the watch's run the athlete %s on the log: the release's fresh set would drop it", async (_label, details) => {
    const log = autoLinkLog();
    givenLinkCreatedLog(log, [{ ...RECORDING_SET, ...details, version: 2 }]);
    tx.returning.mockResolvedValueOnce([{ ...log, source: "manual" }]).mockResolvedValueOnce([RELEASED]);

    const result = await unlink();

    expect(result.log?.source).toBe("manual");
    expect(tx.delete).not.toHaveBeenCalled();
    expect(releasedSet()).toMatchObject({ distance: 8100, notes: null });
  });

  it("re-derives the kept log's adherence snapshot without the run it took off", async () => {
    // Rated, and strides added after the run: the strides' set refresh counted the run.
    const log = autoLinkLog({ rpe: 7, plannedSetCount: 1, actualSetCount: 2, compliancePct: 100 });
    givenLinkCreatedLog(log, [RECORDING_SET, { ...RECORDING_SET, exerciseName: "strides", reps: 6, distance: null }]);
    tx.orderBy.mockResolvedValueOnce([{ exerciseName: "run", customLabel: null }]); // the day's prescription
    tx.returning.mockResolvedValueOnce([{ ...log, source: "manual" }]).mockResolvedValueOnce([RELEASED]);

    await unlink();

    expect(deletedIds()).toEqual(["set-0"]);
    // Written before the unlink's own patch, which returns the row with it.
    expect(patch(0)).toEqual({
      plannedSetCount: 1,
      actualSetCount: 1,
      matchedSetCount: 0,
      addedSetCount: 1,
      removedSetCount: 1,
      compliancePct: 0,
    });
    expect(patch(1)).toMatchObject({ source: "manual", stravaActivityId: null });
  });

  it("leaves a kept log with no adherence snapshot without one: nothing counted the run", async () => {
    const log = autoLinkLog({ rpe: 7 });
    givenLinkCreatedLog(log, [RECORDING_SET]);
    tx.returning.mockResolvedValueOnce([{ ...log, source: "manual" }]).mockResolvedValueOnce([RELEASED]);

    await unlink();

    expect(deletedIds()).toEqual(["set-0"]);
    expect(tx.set).toHaveBeenCalledTimes(1);
    expect(firstPatch()).not.toHaveProperty("compliancePct");
  });
});

describe("unlinking an auto link's log the athlete moved off its day (item 2)", () => {
  it("deletes it while unedited, with no day to re-derive", async () => {
    givenLinkCreatedLog(movedOffItsDay(), [RECORDING_SET]);
    tx.where.mockResolvedValueOnce({ rowCount: 1 }); // the delete
    tx.returning.mockResolvedValueOnce([RELEASED]);

    const result = await unlink();

    expect(result.log).toBeNull();
    expect(tx.delete).toHaveBeenCalledTimes(1);
    expect(tx.delete).toHaveBeenCalledWith(workoutLogs);
    expect(tx.update).not.toHaveBeenCalled();
    expect(storageMocks.getPlanDay).not.toHaveBeenCalled();
    expect(syncPlanDayStatusFromWorkouts).not.toHaveBeenCalled();
    expect(releasedSet()).toMatchObject({ exerciseName: "run", distance: 8100 });
  });

  it("adopts it once edited, as a manual log without the recording's set", async () => {
    const edited = movedOffItsDay({ rpe: 8 });
    givenLinkCreatedLog(edited, [RECORDING_SET]);
    tx.returning.mockResolvedValueOnce([{ ...edited, source: "manual" }]).mockResolvedValueOnce([RELEASED]);

    const result = await unlink();

    expect(firstPatch()).toMatchObject({
      source: "manual",
      notes: "Hold 4:30/km",
      prescribedNotes: "Hold 4:30/km",
      stravaActivityId: null,
      deviceLinkSource: null,
    });
    expect(deletedIds()).toEqual(["set-0"]);
    expect(syncPlanDayStatusFromWorkouts).not.toHaveBeenCalled();
    expect(result.log?.source).toBe("manual");
  });

  it("never deletes a log an earlier unlink adopted and a later link enriched: it is the athlete's", async () => {
    // Marked, but `manual` since the first unlink: it unwinds like their own log.
    const adoptedThenLinked = autoLinkLog({ source: "manual", deviceLinkSource: "manual" });
    tx.for.mockResolvedValue([adoptedThenLinked]);
    tx.returning.mockResolvedValueOnce([adoptedThenLinked]).mockResolvedValueOnce([RELEASED]);

    await unlink();

    expect(tx.delete).not.toHaveBeenCalled();
    expect(tx.orderBy).not.toHaveBeenCalled();
    expect(firstPatch()).not.toHaveProperty("source");
  });
});

describe("unlinking an auto link's log the athlete built a structure on (item 4)", () => {
  // The auto link writes no structure, so a block on its log is the
  // athlete's, scored or not. Counting only scored ones, unlink deleted the
  // log as unedited and the structure with it.
  const ROUNDS_BLOCK = { score: null };

  it("keeps it, adopted as manual, with its blocks, and the run goes with the recording", async () => {
    const log = autoLinkLog();
    givenLinkCreatedLog(log, [RECORDING_SET], [ROUNDS_BLOCK]);
    tx.returning.mockResolvedValueOnce([{ ...log, source: "manual" }]).mockResolvedValueOnce([RELEASED]);

    const result = await unlink();

    expect(result.log?.source).toBe("manual");
    // Only the recording's set is deleted: neither the log nor its blocks.
    expect(tx.delete).toHaveBeenCalledTimes(1);
    expect(tx.delete).toHaveBeenCalledWith(exerciseSets);
    expect(deletedIds()).toEqual(["set-0"]);
    expect(firstPatch()).toMatchObject({ source: "manual", stravaActivityId: null });
    expect(syncPlanDayStatusFromWorkouts).not.toHaveBeenCalled();
    expect(releasedSet()).toMatchObject({ exerciseName: "run", distance: 8100, notes: null });
  });

  it("keeps it when the run was annotated too, and the note goes with the recording", async () => {
    const log = autoLinkLog();
    givenLinkCreatedLog(log, [{ ...RECORDING_SET, version: 2, notes: "Windy" }], [ROUNDS_BLOCK]);
    tx.returning.mockResolvedValueOnce([{ ...log, source: "manual" }]).mockResolvedValueOnce([RELEASED]);

    const result = await unlink();

    expect(result.log?.source).toBe("manual");
    expect(deletedIds()).toEqual(["set-0"]);
    expect(releasedSet()).toMatchObject({ exerciseName: "run", distance: 8100, notes: "Windy" });
  });

  it("still deletes a manual link's log whose only blocks are the plan's, copied in unscored", async () => {
    const copiedRun = { ...RECORDING_SET, distance: 8000, plannedDistance: 8000, time: null };
    const manual = autoLinkLog({
      deviceLinkSource: "manual",
      autoLinkRecordingOnly: false,
      plannedSetCount: 1,
      actualSetCount: 1,
      compliancePct: 100,
    });
    givenLinkCreatedLog(manual, [copiedRun], [ROUNDS_BLOCK]);
    tx.where.mockResolvedValueOnce({ rowCount: 1 }); // the delete
    tx.returning.mockResolvedValueOnce([RELEASED]);

    const result = await unlink();

    expect(result.log).toBeNull();
    expect(tx.delete).toHaveBeenCalledWith(workoutLogs);
  });
});

describe("hasAthleteEdits on an auto link's log moved off its day", () => {
  // No plan day to check the title and date against: the date is checked
  // against the recording's, the only date an auto link matches on.
  const recordingOnly: LinkCreatedLogContents = {
    planDay: undefined,
    sets: [RECORDING_SET],
    blocks: 0,
    scoredBlocks: 0,
  };

  it("finds nothing when it is still what the link built: the move is not an edit", () => {
    expect(hasAthleteEdits(movedOffItsDay(), recordingOnly)).toBe(false);
  });

  it("finds nothing when the only change is a note on the recording's set, which leaves with it", () => {
    const noted = { ...RECORDING_SET, version: 2, notes: "Windy" };
    expect(hasAthleteEdits(movedOffItsDay(), { ...recordingOnly, sets: [noted] })).toBe(false);
  });

  it.each<[string, Partial<WorkoutLog>, Partial<LinkCreatedLogContents>]>([
    ["a moved date", { date: "2026-09-10" }, {}],
    ["an RPE", { rpe: 7 }, {}],
    ["a corrected recording set", {}, { sets: [{ ...RECORDING_SET, distance: 8000, version: 2 }] }],
    ["a labelled recording set", {}, { sets: [{ ...RECORDING_SET, customLabel: "Hills", version: 2 }] }],
    ["no auto link marker, so nothing to say what its date was", { autoLinkRecordingOnly: false }, {}],
  ])("sees %s", (_label, edit, contents) => {
    expect(hasAthleteEdits(movedOffItsDay(edit), { ...recordingOnly, ...contents })).toBe(true);
  });
});

describe("isUncorrectedRecordingSet", () => {
  const log = autoLinkLog();
  type SetChange = Partial<Parameters<typeof isUncorrectedRecordingSet>[1]>;

  it.each<[string, SetChange]>([
    ["the untouched recording set", {}],
    ["the recording's set given only a note (a note bumps the version)", { version: 2, notes: "Windy" }],
    ["the recording's set saved again unchanged", { version: 3 }],
  ])("is %s", (_label, change) => {
    expect(isUncorrectedRecordingSet(log, { ...RECORDING_SET, ...change })).toBe(true);
  });

  it.each<[string, SetChange]>([
    ["the recording's set with its distance corrected", { distance: 8000, version: 2 }],
    ["the recording's set with its time corrected", { time: 47, version: 2 }],
    ["a run typed in place of the recording's set", { distance: 5000, time: 25 }],
    ["a set of another exercise", { exerciseName: "tempo_run", version: 2 }],
    ["a set given reps", { reps: 6, version: 2 }],
    ["a set seeded from the plan", { plannedDistance: 8000, version: 2 }],
    // The athlete made the watch's run part of their session: the release's fresh set has none of it.
    ["the recording's set labelled", { customLabel: "Tempo with hills", version: 2 }],
    ["the recording's set put on a structure step", { blockId: "b-1", stepNumber: 1, version: 2 }],
    ["the recording's set grouped", { groupId: "g-1", stepRole: "work", version: 2 }],
    ["the recording's set given an intensity", { intensity: { zone: 3 }, version: 2 }],
    ["the recording's set given a load", { load: { vest: 10 }, version: 2 }],
    ["the recording's set given a pace", { tempo: { pace: "4:30" }, version: 2 }],
    ["the recording's set given standards", { standards: { note: "strict" }, version: 2 }],
    ["the recording's set given a rep mode", { repMode: "per_side", version: 2 }],
    ["the recording's set given an interval minute", { intervalMinute: 2, cycleNumber: 1, version: 2 }],
  ])("is not %s", (_label, change) => {
    expect(isUncorrectedRecordingSet(log, { ...RECORDING_SET, ...change })).toBe(false);
  });

  it("agrees with isCorrectedRecordingSet: no set is both", () => {
    const changes = [
      {},
      { version: 2 },
      { distance: 8000, version: 2 },
      { time: 47, version: 2 },
      { customLabel: "Hills", version: 2 },
    ];
    for (const change of changes) {
      const set = { ...RECORDING_SET, ...change };
      expect(isUncorrectedRecordingSet(log, set) && isCorrectedRecordingSet(log, set)).toBe(false);
    }
  });

  it("is never a set on a log the auto link no longer carries, or never made", () => {
    expect(isUncorrectedRecordingSet(autoLinkLog({ deviceLinkSource: "manual" }), RECORDING_SET)).toBe(false);
    expect(isUncorrectedRecordingSet(autoLinkLog({ source: "manual" }), RECORDING_SET)).toBe(false);
  });
});

describe("releaseStravaActivityInTx with the note from the recording's set", () => {
  it("puts it on the set it writes", async () => {
    tx.returning.mockResolvedValueOnce([RELEASED]);

    await releaseStravaActivityInTx(tx as never, autoLinkLog(), USER, "km", "Windy");

    expect(releasedSet()).toMatchObject({ workoutLogId: "standalone", exerciseName: "run", notes: "Windy" });
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("puts it on the row's own notes when the recording describes no set, so nothing typed is lost", async () => {
    const standalone = makeWorkoutLog({ id: "standalone", notes: "Morning Run" });
    tx.returning
      .mockResolvedValueOnce([standalone])
      .mockResolvedValueOnce([{ ...standalone, notes: "Morning Run\nWindy" }]);

    const released = await releaseStravaActivityInTx(tx as never, autoLinkLog(), USER, "km", "Windy");

    expect(tx.values).toHaveBeenCalledTimes(1);
    expect(firstPatch()).toEqual({ notes: "Morning Run\nWindy" });
    expect(released.notes).toBe("Morning Run\nWindy");
  });
});

describe("linking a released recording again (item 3)", () => {
  /** The released row: the import's own notes line, plus anything typed on it. */
  function releasedRow(notes: string | null) {
    return makeWorkoutLog({ ...RELEASED, userId: USER, planDayId: null, deviceLinkSource: null, notes });
  }

  /**
   * Queue the reads linkStandaloneDeviceLog makes before it writes: the
   * released row (FOR UPDATE), then its sets' notes.
   */
  function givenReleasedRow(row: WorkoutLog, setNotes: (string | null)[]) {
    tx.for.mockResolvedValueOnce([row]);
    tx.orderBy.mockResolvedValueOnce(setNotes.map((notes) => ({ notes })));
  }

  it("puts the note from the run's set, and a line typed on the row, onto the athlete's log", async () => {
    givenReleasedRow(releasedRow("Morning Run\nFelt flat"), ["Windy on the way back"]);
    const target = makeWorkoutLog({ id: "log-own", notes: "Easy day" });
    tx.for.mockResolvedValueOnce([target]); // attach locks the target
    const attached = { ...target, stravaActivityId: "9001", deviceLinkSource: "manual" as const };
    const annotated = { ...attached, notes: "Easy day\nFelt flat\nWindy on the way back" };
    tx.returning.mockResolvedValueOnce([attached]).mockResolvedValueOnce([annotated]);

    const linked = await linkStandaloneDeviceLog({
      userId: USER,
      deviceLogId: "standalone",
      target: { workoutLogId: "log-own" },
    });

    // The import's own line ("Morning Run", the activity name) is not carried.
    expect(patch(1)).toEqual({ notes: "Easy day\nFelt flat\nWindy on the way back" });
    expect(linked).toBe(annotated);
  });

  it("creates the log a manual link makes on the plan day with the note in it, so it is not an edit of that log", async () => {
    givenReleasedRow(releasedRow("Morning Run\nFelt flat"), ["Windy on the way back"]);
    storageMocks.getPlanDay.mockResolvedValue(TEMPO_DAY);
    const created = makeWorkoutLog({ id: "log-new", planDayId: "pd-1" });
    vi.mocked(createWorkoutInTx).mockResolvedValueOnce(created);

    const linked = await linkStandaloneDeviceLog({
      userId: USER,
      deviceLogId: "standalone",
      target: { planDayId: "pd-1" },
    });

    // In the payload createWorkoutInTx snapshots into prescribedNotes, after
    // the day's notes and the label. Added afterwards, it read as the
    // athlete's edit, and unlink kept the log with the copied 8 km as
    // performed next to the released run, the day still completed.
    expect(vi.mocked(createWorkoutInTx).mock.calls[0][1]).toMatchObject({
      notes: "Hold 4:30/km\nStrava: Morning Run\nFelt flat\nWindy on the way back",
      deviceLinkSource: "manual",
    });
    expect(tx.update).not.toHaveBeenCalled();
    expect(linked).toBe(created);
  });

  it("does not carry the import's own line of a row imported before the snapshot column", async () => {
    // Legacy: the activity is rebuilt from the row's notes (legacyRawFromLog).
    const legacy = makeWorkoutLog({ ...releasedRow("Morning Run\nFelt flat"), deviceActivity: null });
    givenReleasedRow(legacy, [null]);
    const target = makeWorkoutLog({ id: "log-own", notes: "Easy day" });
    tx.for.mockResolvedValueOnce([target]);
    const attached = { ...target, stravaActivityId: "9001", deviceLinkSource: "manual" as const };
    tx.returning.mockResolvedValueOnce([attached]).mockResolvedValueOnce([attached]);

    await linkStandaloneDeviceLog({ userId: USER, deviceLogId: "standalone", target: { workoutLogId: "log-own" } });

    expect(patch(0)).toMatchObject({ deviceActivity: { raw: { name: "Morning Run" } } });
    expect(patch(1)).toEqual({ notes: "Easy day\nFelt flat" });
  });

  it("writes nothing more when the athlete typed nothing on the row", async () => {
    givenReleasedRow(releasedRow("Morning Run"), [null]);
    const target = makeWorkoutLog({ id: "log-own", notes: "Easy day" });
    tx.for.mockResolvedValueOnce([target]);
    const attached = { ...target, stravaActivityId: "9001", deviceLinkSource: "manual" as const };
    tx.returning.mockResolvedValueOnce([attached]);

    const linked = await linkStandaloneDeviceLog({
      userId: USER,
      deviceLogId: "standalone",
      target: { workoutLogId: "log-own" },
    });

    expect(tx.set).toHaveBeenCalledTimes(1); // the attach alone
    expect(linked).toBe(attached);
  });
});

describe("unlinking the log a manual link created with the note it carried (item 3)", () => {
  /** The tempo day's prescribed run as createWorkoutInTx copies it in: actual equal to the prescription. */
  const COPIED_RUN = { ...RECORDING_SET, distance: 8000, plannedDistance: 8000, time: null };

  /**
   * The log linkStandaloneDeviceLog creates on the tempo day from a released
   * recording whose set carried "Windy on the way back": the day's notes,
   * the label, the note, all in the notes snapshot; the copied prescription.
   */
  function manualLinkLog(overrides: Partial<WorkoutLog> = {}): WorkoutLog {
    const notes = "Hold 4:30/km\nStrava: Morning Run\nWindy on the way back";
    return autoLinkLog({
      deviceLinkSource: "manual",
      deviceLinkConfidence: null,
      autoLinkRecordingOnly: false,
      plannedSetCount: 1,
      actualSetCount: 1,
      compliancePct: 100,
      notes,
      prescribedNotes: notes,
      ...overrides,
    });
  }

  it("deletes the otherwise untouched log and hands the note back to the recording's set", async () => {
    givenLinkCreatedLog(manualLinkLog(), [COPIED_RUN]);
    tx.returning.mockResolvedValueOnce([RELEASED]);

    const result = await unlink();

    // Kept as edited, its copied 8 km stayed as performed next to the
    // released 8.1 km, and the wrong day stayed completed.
    expect(
      hasAthleteEdits(manualLinkLog(), { planDay: TEMPO_DAY, sets: [COPIED_RUN], blocks: 0, scoredBlocks: 0 }),
    ).toBe(false);
    expect(result.log).toBeNull();
    expect(deletedIds()).toEqual(["log-2"]);
    expect(syncPlanDayStatusFromWorkouts).toHaveBeenCalledWith("pd-1", USER, tx);
    expect(releasedSet()).toMatchObject({ exerciseName: "run", distance: 8100, notes: "Windy on the way back" });
  });

  it("hands back only the lines after the label, though the day's notes changed since the link", async () => {
    givenLinkCreatedLog(manualLinkLog(), [COPIED_RUN]);
    storageMocks.getPlanDay.mockResolvedValue({ ...TEMPO_DAY, notes: "Hold 4:20/km" });
    tx.returning.mockResolvedValueOnce([RELEASED]);

    await unlink();

    // "Hold 4:30/km" was the plan's then, not anything the athlete wrote.
    expect(releasedSet()).toMatchObject({ notes: "Windy on the way back" });
  });

  it("hands back the lines that are not the day's notes for a recording with no name, and so no label", async () => {
    const unnamed = { ...SNAPSHOT, raw: { ...RAW, name: "" }, filledColumns: ["duration", "distanceMeters"] };
    const log = manualLinkLog({
      deviceActivity: unnamed,
      notes: "Hold 4:30/km\nWindy on the way back",
      prescribedNotes: "Hold 4:30/km\nWindy on the way back",
    });
    givenLinkCreatedLog(log, [COPIED_RUN]);
    storageMocks.getPlanDay.mockResolvedValue(TEMPO_DAY);
    tx.returning.mockResolvedValueOnce([{ ...RELEASED, deviceActivity: { ...unnamed, filledColumns: [] } }]);

    await unlink();

    expect(releasedSet()).toMatchObject({ notes: "Windy on the way back" });
  });

  it("leaves the note on a log the athlete has since edited, which unlink keeps", async () => {
    const log = manualLinkLog({ rpe: 6 });
    givenLinkCreatedLog(log, [COPIED_RUN]);
    tx.returning.mockResolvedValueOnce([{ ...log, source: "manual" }]).mockResolvedValueOnce([RELEASED]);

    const result = await unlink();

    expect(result.log?.source).toBe("manual");
    expect(tx.delete).not.toHaveBeenCalled();
    expect(firstPatch()).toMatchObject({ source: "manual", notes: "Hold 4:30/km\nWindy on the way back" });
    expect(releasedSet()).toMatchObject({ notes: null });
  });

  it("hands back nothing from the notes of a log an auto link created", async () => {
    givenLinkCreatedLog(autoLinkLog(), [RECORDING_SET]);
    tx.returning.mockResolvedValueOnce([RELEASED]);

    await unlink();

    expect(releasedSet()).toMatchObject({ notes: null });
  });
});
