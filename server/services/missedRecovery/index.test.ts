import type { ExerciseSet, TimelineEntry } from "@shared/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockPlanDay, createMockTrainingPlan } from "../../../test/factories";
import type { storage } from "../../storage";
import { enqueueAutoCoachInBackground } from "../autoCoachQueue";
import { applyMissedSessionRecovery, getMissedSessionRecoveryPreview } from "./index";

// Standalone mocks, typed as the storage methods they stand in for, so the
// tests read and assert on them without detaching methods from `storage`.
const mocks = vi.hoisted(() => ({
  getPlanDay: vi.fn<typeof storage.plans.getPlanDay>(),
  listTrainingPlans: vi.fn<typeof storage.plans.listTrainingPlans>(),
  applyPlanDayRecovery: vi.fn<typeof storage.plans.applyPlanDayRecovery>(),
  getUser: vi.fn<typeof storage.users.getUser>(),
  getTimelinePage: vi.fn<typeof storage.timeline.getTimelinePage>(),
  listAnnotations: vi.fn<typeof storage.timelineAnnotations.list>(),
  getExerciseSetsByPlanDay: vi.fn<typeof storage.workouts.getExerciseSetsByPlanDay>(),
  getWorkoutStructureByPlanDay: vi.fn<typeof storage.workouts.getWorkoutStructureByPlanDay>(),
}));

vi.mock("../../storage", () => ({
  storage: {
    plans: {
      getPlanDay: mocks.getPlanDay,
      listTrainingPlans: mocks.listTrainingPlans,
      applyPlanDayRecovery: mocks.applyPlanDayRecovery,
    },
    users: { getUser: mocks.getUser },
    timeline: { getTimelinePage: mocks.getTimelinePage },
    timelineAnnotations: { list: mocks.listAnnotations },
    workouts: {
      getExerciseSetsByPlanDay: mocks.getExerciseSetsByPlanDay,
      getWorkoutStructureByPlanDay: mocks.getWorkoutStructureByPlanDay,
    },
  },
}));
vi.mock("../autoCoachQueue", () => ({ enqueueAutoCoachInBackground: vi.fn() }));

/** The write the service last handed to storage. */
function lastWrite() {
  const call = mocks.applyPlanDayRecovery.mock.lastCall;
  if (!call) throw new Error("no recovery was written");
  return call[2];
}

const USER = "user-1";
// Thursday 24 September 2026 in the athlete's zone.
const NOW = new Date("2026-09-24T12:00:00Z");

const missedDay = createMockPlanDay({
  id: "pd-missed",
  planId: "plan-1",
  focus: "Threshold run",
  mainWorkout: "5 x 1 km at threshold",
  scheduledDate: "2026-09-22",
  status: "missed",
});

function intervalSets(): ExerciseSet[] {
  return [1, 2, 3, 4, 5].map(
    (setNumber) =>
      ({
        id: `set-${setNumber}`,
        planDayId: "pd-missed",
        workoutLogId: null,
        exerciseName: "interval_run",
        customLabel: null,
        category: "running",
        setNumber,
        sortOrder: setNumber,
        reps: null,
        plannedReps: null,
        distance: null,
        plannedDistance: 1000,
        time: null,
        plannedTime: null,
        distanceUnit: "m",
        blockId: null,
      }) as unknown as ExerciseSet,
  );
}

function entry(date: string, focus: string, overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    id: `plan-${focus}`,
    date,
    type: "planned",
    status: "planned",
    focus,
    mainWorkout: focus,
    accessory: null,
    notes: null,
    planDayId: `pd-${focus}`,
    priority: "supporting",
    expectedDurationMin: 45,
    expectedRpe: 5,
    exerciseSets: [],
    structureBlocks: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mocks.getPlanDay.mockResolvedValue(missedDay);
  mocks.getUser.mockResolvedValue({ userTimezone: "UTC", distanceUnit: "km" } as never);
  mocks.listTrainingPlans.mockResolvedValue([
    createMockTrainingPlan({ id: "plan-1", startDate: "2026-09-07", endDate: "2026-11-01" }),
  ]);
  mocks.listAnnotations.mockResolvedValue([]);
  mocks.getExerciseSetsByPlanDay.mockResolvedValue(intervalSets());
  mocks.getWorkoutStructureByPlanDay.mockResolvedValue([]);
  mocks.getTimelinePage.mockResolvedValue({
    entries: [
      entry("2026-09-22", "Threshold run", { planDayId: "pd-missed", status: "missed", priority: "key" }),
      entry("2026-09-25", "Strength B"),
      entry("2026-09-27", "Long run", { priority: "key", expectedDurationMin: 90, expectedRpe: 4 }),
      entry("2026-09-23", "Rest", { priority: undefined }),
    ],
    nextCursor: null,
  });
  mocks.applyPlanDayRecovery.mockImplementation(async (_id, _user, write) => ({
    outcome: "applied",
    day: { ...missedDay, ...write.update },
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getMissedSessionRecoveryPreview", () => {
  it("builds the preview from the athlete's own timeline", async () => {
    const preview = await getMissedSessionRecoveryPreview(USER, "pd-missed");

    expect(preview.planDayId).toBe("pd-missed");
    expect(preview.today).toBe("2026-09-24");
    expect(preview.priority).toBe("key");
    // Five 1 km intervals estimate to about 38 minutes; three of them are 60%.
    expect(preview.session).toMatchObject({ estimated: false, rpe: 8, hard: true });
    expect(preview.shorten.changes).toEqual([{ label: "Intervals", from: "5 sets", to: "3 sets" }]);
    expect(preview.shorten.keptFraction).toBe(0.6);
    // Today is free and clear of hard neighbours: the full session fits.
    expect(preview.recommendation).toMatchObject({ action: "fold", targetDate: "2026-09-24" });
    // The rest day and the missed session itself are not "sessions around it".
    const today = preview.fold.targets.find((target) => target.date === "2026-09-24");
    expect(today?.sessions).toEqual([]);
    // Read backwards from the end of the last candidate day's week (Sun 4 Oct).
    expect(mocks.getTimelinePage).toHaveBeenCalledWith(USER, { limit: 60, before: "2026-10-05" });
  });

  it("reads a table-less session's length from its text, and assumes an hour only when the text doesn't say", async () => {
    mocks.getExerciseSetsByPlanDay.mockResolvedValue([]);

    mocks.getPlanDay.mockResolvedValueOnce({ ...missedDay, focus: "Tempo run", mainWorkout: "10 min easy, 25 min tempo, 10 min easy" });
    const written = await getMissedSessionRecoveryPreview(USER, "pd-missed");
    expect(written.session).toMatchObject({ durationMin: 45, estimated: false });

    mocks.getPlanDay.mockResolvedValueOnce({ ...missedDay, focus: "Tempo run", mainWorkout: "Tempo, by feel" });
    const unsaid = await getMissedSessionRecoveryPreview(USER, "pd-missed");
    expect(unsaid.session).toMatchObject({ durationMin: 60, estimated: true });
  });

  it("reads back page by page until the missed week is covered, however long the plan runs", async () => {
    mocks.getTimelinePage
      .mockResolvedValueOnce({
        entries: [entry("2026-10-04", "Long run", { priority: "key" }), entry("2026-09-28", "Strength A")],
        nextCursor: "2026-09-28",
      })
      .mockResolvedValueOnce({
        entries: [
          entry("2026-09-25", "Strength B"),
          entry("2026-09-22", "Threshold run", { planDayId: "pd-missed", status: "missed", priority: "key" }),
        ],
        nextCursor: "2026-09-22",
      })
      .mockResolvedValueOnce({ entries: [entry("2026-09-20", "Long run", { priority: "key" })], nextCursor: null });

    const preview = await getMissedSessionRecoveryPreview(USER, "pd-missed");

    expect(mocks.getTimelinePage).toHaveBeenNthCalledWith(2, USER, { limit: 60, before: "2026-09-28" });
    expect(mocks.getTimelinePage).toHaveBeenNthCalledWith(3, USER, { limit: 60, before: "2026-09-22" });
    // Friday's session came from the second page, so Friday is not "free".
    const friday = preview.fold.targets.find((target) => target.date === "2026-09-25");
    expect(friday?.sessions.map((session) => session.focus)).toEqual(["Strength B"]);
    // The Sunday before the missed week is outside the window: it isn't counted in that week.
    const missedWeek = preview.letGo.impact.weeks.find((week) => week.weekStart === "2026-09-21");
    expect(missedWeek?.minutesAfter).toBe(45);
  });

  it("refuses a day that isn't missed, a rest day, and someone else's day", async () => {
    mocks.getPlanDay.mockResolvedValueOnce({ ...missedDay, status: "completed" });
    await expect(getMissedSessionRecoveryPreview(USER, "pd-missed")).rejects.toMatchObject({ status: 409 });

    mocks.getPlanDay.mockResolvedValueOnce({ ...missedDay, focus: "Rest", mainWorkout: "Rest" });
    await expect(getMissedSessionRecoveryPreview(USER, "pd-missed")).rejects.toMatchObject({
      status: 409,
      message: "Rest days don't need recovering.",
    });

    mocks.getPlanDay.mockResolvedValueOnce(undefined);
    await expect(getMissedSessionRecoveryPreview(USER, "pd-missed")).rejects.toMatchObject({ status: 404 });
  });

  it("counts a past day the sweep has not reached yet as missed, but not one an absence excuses", async () => {
    mocks.getPlanDay.mockResolvedValueOnce({ ...missedDay, status: "planned" });
    await expect(getMissedSessionRecoveryPreview(USER, "pd-missed")).resolves.toMatchObject({ planDayId: "pd-missed" });

    mocks.listAnnotations.mockResolvedValueOnce([
      { startDate: "2026-09-21", endDate: "2026-09-23" } as never,
    ]);
    await expect(getMissedSessionRecoveryPreview(USER, "pd-missed")).rejects.toMatchObject({ status: 409 });
  });
});

describe("applyMissedSessionRecovery", () => {
  it("folds the session into the chosen day, remembering where it was missed", async () => {
    const day = await applyMissedSessionRecovery(USER, "pd-missed", { action: "fold", targetDate: "2026-09-24" });

    expect(mocks.applyPlanDayRecovery).toHaveBeenCalledWith("pd-missed", USER, {
      guard: { statuses: ["missed"], scheduledDate: "2026-09-22", recovery: null },
      update: {
        scheduledDate: "2026-09-24",
        status: "planned",
        recovery: "folded",
        missedOn: "2026-09-22",
        skipReason: null,
        // What the undo needs to put it back.
        recoveryUndo: {
          scheduledDate: "2026-09-22",
          status: "missed",
          recovery: null,
          missedOn: null,
          deletedSets: [],
          scaledSets: [],
          previous: null,
        },
      },
    });
    expect(day).toMatchObject({ scheduledDate: "2026-09-24", recovery: "folded" });
    expect(enqueueAutoCoachInBackground).toHaveBeenCalledWith(USER, "plan-day-rescheduled");
  });

  it("shortens it by dropping the last intervals, leaving the notes alone when the table shows the cut", async () => {
    await applyMissedSessionRecovery(USER, "pd-missed", { action: "shorten", targetDate: "2026-09-26" });

    const write = lastWrite();
    expect(write.update).toMatchObject({ scheduledDate: "2026-09-26", status: "planned", recovery: "shortened" });
    expect(write.update).not.toHaveProperty("notes");
    expect(write.update).not.toHaveProperty("expectedDurationMin");
    expect(write.deleteSetIds).toEqual(["set-4", "set-5"]);
    // The dropped intervals are kept, whole, for the undo.
    expect(write.update.recoveryUndo?.deletedSets.map((set) => set.id)).toEqual(["set-4", "set-5"]);
  });

  it("pins the length and adds an instruction when there is no table to cut", async () => {
    mocks.getExerciseSetsByPlanDay.mockResolvedValue([]);
    mocks.getPlanDay.mockResolvedValue({ ...missedDay, expectedDurationMin: 50, notes: "Hold 4:10/km" });

    await applyMissedSessionRecovery(USER, "pd-missed", { action: "shorten", targetDate: "2026-09-24" });

    const write = lastWrite();
    expect(write.update).toMatchObject({
      expectedDurationMin: 30,
      notes: "Shortened after it was missed on Tue 22 Sep: do about 60% of it.\nHold 4:10/km",
    });
    expect(write.update.recoveryUndo).toMatchObject({
      notes: { before: "Hold 4:10/km", after: "Shortened after it was missed on Tue 22 Sep: do about 60% of it.\nHold 4:10/km" },
      expectedDurationMin: { before: 50, after: 30 },
    });
  });

  it("takes a shorten back: the day it was missed on, undecided, with the whole table", async () => {
    await applyMissedSessionRecovery(USER, "pd-missed", { action: "shorten", targetDate: "2026-09-26" });
    const shortened = { ...missedDay, ...lastWrite().update };
    mocks.getPlanDay.mockResolvedValue(shortened);
    // Sets 4 and 5 are gone now.
    mocks.getExerciseSetsByPlanDay.mockResolvedValue(intervalSets().slice(0, 3));
    vi.mocked(enqueueAutoCoachInBackground).mockClear();

    await applyMissedSessionRecovery(USER, "pd-missed", { action: "reopen" });

    const undo = lastWrite();
    expect(undo.guard).toEqual({ statuses: ["planned"], scheduledDate: "2026-09-26", recovery: "shortened" });
    expect(undo.update).toEqual({
      scheduledDate: "2026-09-22",
      status: "missed",
      recovery: null,
      missedOn: null,
      recoveryUndo: null,
    });
    expect(undo.insertSets?.map((set) => set.id)).toEqual(["set-4", "set-5"]);
    expect(enqueueAutoCoachInBackground).toHaveBeenCalledWith(USER, "plan-day-rescheduled");
  });

  it("won't take a move back once the session has been done", async () => {
    await applyMissedSessionRecovery(USER, "pd-missed", { action: "fold", targetDate: "2026-09-24" });
    mocks.getPlanDay.mockResolvedValue({ ...missedDay, ...lastWrite().update, status: "completed" });
    mocks.applyPlanDayRecovery.mockClear();

    await expect(applyMissedSessionRecovery(USER, "pd-missed", { action: "reopen" })).rejects.toMatchObject({
      status: 409,
    });
    expect(mocks.applyPlanDayRecovery).not.toHaveBeenCalled();
  });

  it("refuses a day the preview would not offer", async () => {
    await expect(
      applyMissedSessionRecovery(USER, "pd-missed", { action: "fold", targetDate: "2026-10-20" }),
    ).rejects.toMatchObject({ status: 400 });
    expect(mocks.applyPlanDayRecovery).not.toHaveBeenCalled();
  });

  it("lets it go without moving it, and writes the status a not-yet-swept day is missing", async () => {
    mocks.getPlanDay.mockResolvedValue({ ...missedDay, status: "planned" });

    await applyMissedSessionRecovery(USER, "pd-missed", { action: "let_go" });

    expect(mocks.applyPlanDayRecovery).toHaveBeenCalledWith("pd-missed", USER, {
      guard: { statuses: ["planned"], scheduledDate: "2026-09-22", recovery: null },
      update: { status: "missed", recovery: "let_go" },
    });
    expect(enqueueAutoCoachInBackground).not.toHaveBeenCalled();
  });

  it("reopens only a decision the timeline shows", async () => {
    await expect(applyMissedSessionRecovery(USER, "pd-missed", { action: "reopen" })).rejects.toMatchObject({
      status: 409,
    });
    // Left behind on a day that was logged and then unlogged: not a let-go the timeline shows.
    mocks.getPlanDay.mockResolvedValueOnce({ ...missedDay, status: "planned", recovery: "let_go" });
    await expect(applyMissedSessionRecovery(USER, "pd-missed", { action: "reopen" })).rejects.toMatchObject({
      status: 409,
    });

    mocks.getPlanDay.mockResolvedValue({ ...missedDay, recovery: "let_go" });
    await applyMissedSessionRecovery(USER, "pd-missed", { action: "reopen" });
    expect(mocks.applyPlanDayRecovery).toHaveBeenCalledWith("pd-missed", USER, {
      guard: { statuses: ["missed"], scheduledDate: "2026-09-22", recovery: "let_go" },
      update: { recovery: null },
    });
  });

  it("reopens a let-go of a session that had already been moved as moved, not as new", async () => {
    mocks.getPlanDay.mockResolvedValue({ ...missedDay, recovery: "let_go", missedOn: "2026-09-18" });

    await applyMissedSessionRecovery(USER, "pd-missed", { action: "reopen" });

    expect(mocks.applyPlanDayRecovery).toHaveBeenCalledWith("pd-missed", USER, {
      guard: { statuses: ["missed"], scheduledDate: "2026-09-22", recovery: "let_go" },
      update: { recovery: "folded" },
    });
  });

  it("turns a decision made against a stale preview into a conflict", async () => {
    mocks.applyPlanDayRecovery.mockResolvedValue({ outcome: "conflict" });

    await expect(applyMissedSessionRecovery(USER, "pd-missed", { action: "let_go" })).rejects.toMatchObject({
      status: 409,
    });
  });
});
