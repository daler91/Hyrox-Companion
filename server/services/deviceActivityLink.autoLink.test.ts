import type { StravaActivitySummary, WorkoutLog } from "@shared/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockPlanDay } from "../../test/factories";
import { syncPlanDayStatusFromWorkouts } from "../storage/planDayStatus";
import {
  createLogFromPlanDayWithStravaInTx,
  hasAthleteEdits,
  type LinkCreatedLogContents,
  pickDeviceMetrics,
} from "./deviceActivityLink";
import { mapStravaActivityToWorkout } from "./stravaMapper";
import { makeWorkoutLog } from "./trainingLoadService.testHelpers";
import { createWorkoutInTx } from "./workoutService";

/**
 * D12 (CODEBASE_ANALYSIS_2026-10-03): a recording the sync links to a plan day
 * on its own must not record the prescription as what was performed. The
 * fixtures here are the ones the earlier tests avoided: a run shorter than
 * planned, and a "Weight Training" recording on a loaded strength day.
 */

vi.mock("../db", () => ({ db: { transaction: vi.fn() } }));
vi.mock("../storage", () => ({ storage: { plans: { getPlanDay: vi.fn() } } }));
vi.mock("../storage/planDayStatus", () => ({ syncPlanDayStatusFromWorkouts: vi.fn() }));
vi.mock("./workoutService", () => ({ createWorkoutInTx: vi.fn() }));
vi.mock("./unitPreferences", () => ({
  loadUnitPreferences: vi.fn().mockResolvedValue({ weightUnit: "kg", distanceUnit: "km" }),
}));

const USER = "user-1";

function recording(overrides: Partial<StravaActivitySummary>): StravaActivitySummary {
  return {
    id: 9001,
    name: "Morning Run",
    type: "Run",
    sport_type: "Run",
    start_date: "2026-09-08T11:30:00Z",
    start_date_local: "2026-09-08T06:30:00Z",
    distance: 6100,
    moving_time: 30 * 60,
    elapsed_time: 31 * 60,
    total_elevation_gain: 20,
    average_speed: 3.4,
    max_speed: 4.1,
    average_heartrate: 158,
    max_heartrate: 174,
    ...overrides,
  };
}

const SHORT_RUN = recording({});
const WEIGHT_TRAINING = recording({
  id: 9002,
  name: "Evening Weight Training",
  type: "WeightTraining",
  sport_type: "WeightTraining",
  distance: 0,
  moving_time: 60 * 60,
  elapsed_time: 60 * 60,
});

const TEMPO_DAY = createMockPlanDay({
  id: "pd-tempo",
  planId: "plan-1",
  scheduledDate: "2026-09-08",
  focus: "Tempo run",
  mainWorkout: "8 km tempo",
});
const SQUAT_DAY = createMockPlanDay({
  id: "pd-squat",
  planId: "plan-1",
  scheduledDate: "2026-09-08",
  focus: "Strength",
  mainWorkout: "Back squat 5x5 @ 110kg",
});

/** A tx whose first insert returns the row it was given, so the set builder reads the real log. */
function makeTx() {
  const insertedValues: Record<string, unknown>[] = [];
  const tx = {
    insert: vi.fn(() => tx),
    values: vi.fn((row: Record<string, unknown>) => {
      insertedValues.push(row);
      return tx;
    }),
    returning: vi.fn(() =>
      Promise.resolve([
        makeWorkoutLog({ ...(insertedValues[0] as Partial<WorkoutLog>), id: "auto-log" }),
      ]),
    ),
  };
  return { tx, insertedValues };
}

async function autoLink(planDay: typeof TEMPO_DAY, raw: StravaActivitySummary) {
  const { tx, insertedValues } = makeTx();
  const log = await createLogFromPlanDayWithStravaInTx(tx as never, {
    userId: USER,
    planDay,
    raw,
    metrics: pickDeviceMetrics(mapStravaActivityToWorkout(raw, USER, "km")),
    linkSource: "auto",
    confidence: 0.8,
  });
  return { tx, log, logRow: insertedValues[0], setRows: insertedValues.slice(1) };
}

describe("createLogFromPlanDayWithStravaInTx — auto link (D12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records the run the watch measured, not the 8 km the plan prescribed", async () => {
    const { tx, logRow, setRows } = await autoLink(TEMPO_DAY, SHORT_RUN);

    // Nothing goes through the copy path that writes the prescription as actuals.
    expect(createWorkoutInTx).not.toHaveBeenCalled();
    expect(logRow).toMatchObject({
      planDayId: "pd-tempo",
      planId: "plan-1",
      source: "strava",
      stravaActivityId: "9001",
      deviceLinkSource: "auto",
      distanceMeters: 6100,
      mainWorkout: "8 km tempo",
      prescribedMainWorkout: "8 km tempo",
      // The record that outlives the link: this log never held the prescription.
      autoLinkRecordingOnly: true,
    });
    // No adherence snapshot: one recording cannot be compared set for set.
    expect(logRow.compliancePct).toBeUndefined();
    expect(logRow.plannedSetCount).toBeUndefined();

    expect(setRows).toHaveLength(1);
    expect(setRows[0]).toMatchObject({
      workoutLogId: "auto-log",
      exerciseName: "run",
      distance: 6100,
      reps: null,
      weight: null,
    });
    expect(setRows[0].time).toBeCloseTo(30);
    expect(setRows[0].plannedDistance).toBeUndefined();

    expect(syncPlanDayStatusFromWorkouts).toHaveBeenCalledWith("pd-tempo", USER, tx);
  });

  it("completes a strength day from a 'Weight Training' recording without inventing a lift", async () => {
    const { tx, logRow, setRows } = await autoLink(SQUAT_DAY, WEIGHT_TRAINING);

    expect(createWorkoutInTx).not.toHaveBeenCalled();
    expect(logRow).toMatchObject({
      planDayId: "pd-squat",
      deviceLinkSource: "auto",
      autoLinkRecordingOnly: true,
    });
    // No 110 kg squat nobody lifted: no set at all, so no false PR.
    expect(setRows).toEqual([]);
    expect(syncPlanDayStatusFromWorkouts).toHaveBeenCalledWith("pd-squat", USER, tx);
  });

  it("keeps the athlete's Strava rating as the RPE on an auto-linked day", async () => {
    const { tx } = makeTx();
    await createLogFromPlanDayWithStravaInTx(tx as never, {
      userId: USER,
      planDay: TEMPO_DAY,
      raw: SHORT_RUN,
      metrics: { ...pickDeviceMetrics(mapStravaActivityToWorkout(SHORT_RUN, USER, "km")), rpe: 7 },
      linkSource: "auto",
      confidence: 0.8,
    });
    const [logRow] = vi.mocked(tx.values).mock.calls[0];
    expect(logRow).toMatchObject({ rpe: 7 });
  });

  it("still builds the athlete's own link the way a manual confirm does", async () => {
    vi.mocked(createWorkoutInTx).mockResolvedValue(makeWorkoutLog({ id: "manual-log" }));
    const { tx } = makeTx();

    await createLogFromPlanDayWithStravaInTx(tx as never, {
      userId: USER,
      planDay: SQUAT_DAY,
      raw: WEIGHT_TRAINING,
      metrics: pickDeviceMetrics(mapStravaActivityToWorkout(WEIGHT_TRAINING, USER, "km")),
      linkSource: "manual",
      confidence: null,
    });

    expect(createWorkoutInTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ planDayId: "pd-squat", deviceLinkSource: "manual" }),
      undefined,
      undefined,
      USER,
    );
    // A manual link copies the prescription in, so its log is not marked.
    expect(vi.mocked(createWorkoutInTx).mock.calls[0][1]).not.toHaveProperty("autoLinkRecordingOnly");
    expect(tx.insert).not.toHaveBeenCalled();
  });
});

describe("hasAthleteEdits — an auto link since D12", () => {
  /** The plan-day log an auto link writes from SHORT_RUN on TEMPO_DAY. */
  function autoLinkedLog(overrides: Partial<WorkoutLog> = {}): WorkoutLog {
    return makeWorkoutLog({
      id: "auto-log",
      source: "strava",
      date: "2026-09-08",
      focus: "Tempo run",
      mainWorkout: "8 km tempo",
      prescribedMainWorkout: "8 km tempo",
      notes: "Strava: Morning Run",
      prescribedNotes: "Strava: Morning Run",
      plannedSetCount: null,
      planDayId: "pd-tempo",
      duration: 30,
      distanceMeters: 6100,
      stravaActivityId: "9001",
      deviceLinkSource: "auto",
      deviceLinkConfidence: 0.8,
      autoLinkRecordingOnly: true,
      deviceActivity: {
        provider: "strava",
        raw: SHORT_RUN,
        filledColumns: ["duration", "distanceMeters"],
        linkedAt: "2026-09-08T12:00:00Z",
      },
      ...overrides,
    });
  }

  const RECORDED_SET = {
    exerciseName: "run",
    version: 1,
    reps: null,
    plannedReps: null,
    weight: null,
    plannedWeight: null,
    distance: 6100,
    plannedDistance: null,
    time: 30,
    plannedTime: null,
    distanceUnit: "m",
  } as const;

  const untouched: LinkCreatedLogContents = {
    planDay: TEMPO_DAY,
    sets: [RECORDED_SET],
    blocks: 0,
    scoredBlocks: 0,
  };

  it("finds nothing on the log while it holds only the recording's set", () => {
    expect(hasAthleteEdits(autoLinkedLog(), untouched)).toBe(false);
  });

  it("finds nothing on a strength day the recording could not describe as a set", () => {
    expect(
      hasAthleteEdits(autoLinkedLog({ focus: "Strength" }), {
        ...untouched,
        planDay: SQUAT_DAY,
        sets: [],
      }),
    ).toBe(false);
  });

  it.each<[string, LinkCreatedLogContents["sets"]]>([
    ["a corrected recording set", [{ ...RECORDED_SET, distance: 6000, version: 2 }]],
    // The watch's numbers, but labelled as part of their session (InlineSetEditor).
    ["a labelled recording set", [{ ...RECORDED_SET, customLabel: "Tempo with hills", version: 2 }]],
    ["a recording set put on a structure step", [{ ...RECORDED_SET, blockId: "b-1", stepNumber: 1, version: 2 }]],
    // The prescription copied in by the athlete (seed from plan): not the auto link's shape.
    ["a copy of the prescription", [{ ...RECORDED_SET, distance: 8000, plannedDistance: 8000, time: null }]],
    [
      "a lift typed in its place",
      [{ ...RECORDED_SET, exerciseName: "back_squat", reps: 5, weight: 110 }],
    ],
    ["a set of other work", [{ ...RECORDED_SET, exerciseName: "rowing" }]],
    // Version 1 like the recording's set, which they deleted; not its distance.
    ["a run typed in place of the recording's", [{ ...RECORDED_SET, distance: 5000 }]],
    ["an added set", [RECORDED_SET, { ...RECORDED_SET, distance: 1000 }]],
  ])("sees %s", (_label, sets) => {
    expect(hasAthleteEdits(autoLinkedLog(), { ...untouched, sets })).toBe(true);
  });

  // D12 (CODEBASE_ANALYSIS_2026-10-03): a note on the run is about the
  // recording and leaves with it on unlink. Read as an edit, it kept an empty
  // log that still completed the day.
  it("finds nothing when the athlete only wrote a note on the recording's set", () => {
    const noted = { ...RECORDED_SET, version: 2, notes: "Windy" };
    expect(hasAthleteEdits(autoLinkedLog(), { ...untouched, sets: [noted] })).toBe(false);
  });

  // The set PATCH re-derives an adherence snapshot (refreshDerivedStateAfterLoggedSetChange),
  // and moving the log back onto its day writes one: derived from the link's own set.
  it("does not read an adherence snapshot taken from the link's own set as an edit", () => {
    const rederived = autoLinkedLog({ plannedSetCount: 1, actualSetCount: 1, compliancePct: 100 });
    expect(hasAthleteEdits(rederived, untouched)).toBe(false);
  });

  // D12 (CODEBASE_ANALYSIS_2026-10-03): the auto link writes no structure, so
  // every block on its log is the athlete's. Saving one leaves the recording's
  // set off its steps, so counting only scored blocks, unlink deleted the log
  // and the structure with it.
  it.each<[string, Partial<LinkCreatedLogContents>]>([
    ["an unscored block", { blocks: 1 }],
    ["an unscored block beside a note on the recording's set", { blocks: 1, sets: [{ ...RECORDED_SET, version: 2, notes: "Windy" }] }],
    ["a scored block", { blocks: 1, scoredBlocks: 1 }],
  ])("sees %s the athlete built on it", (_label, contents) => {
    expect(hasAthleteEdits(autoLinkedLog(), { ...untouched, ...contents })).toBe(true);
  });
});
