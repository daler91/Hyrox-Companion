import type { ExerciseSet, TimelineEntry } from "@shared/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMockPlanDay, createMockTrainingPlan } from "../../../test/factories";
import { storage } from "../../storage";
import { enqueueAutoCoachInBackground } from "../autoCoachQueue";
import { applyMissedSessionRecovery, getMissedSessionRecoveryPreview } from "./index";

vi.mock("../../storage", () => ({
  storage: {
    plans: {
      getPlanDay: vi.fn(),
      listTrainingPlans: vi.fn(),
      applyPlanDayRecovery: vi.fn(),
    },
    users: { getUser: vi.fn() },
    timeline: { getTimelinePage: vi.fn() },
    timelineAnnotations: { list: vi.fn() },
    workouts: {
      getExerciseSetsByPlanDay: vi.fn(),
      getWorkoutStructureByPlanDay: vi.fn(),
    },
  },
}));
vi.mock("../autoCoachQueue", () => ({ enqueueAutoCoachInBackground: vi.fn() }));

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
  vi.mocked(storage.plans.getPlanDay).mockResolvedValue(missedDay);
  vi.mocked(storage.users.getUser).mockResolvedValue({ userTimezone: "UTC", distanceUnit: "km" } as never);
  vi.mocked(storage.plans.listTrainingPlans).mockResolvedValue([
    createMockTrainingPlan({ id: "plan-1", startDate: "2026-09-07", endDate: "2026-11-01" }),
  ]);
  vi.mocked(storage.timelineAnnotations.list).mockResolvedValue([]);
  vi.mocked(storage.workouts.getExerciseSetsByPlanDay).mockResolvedValue(intervalSets());
  vi.mocked(storage.workouts.getWorkoutStructureByPlanDay).mockResolvedValue([]);
  vi.mocked(storage.timeline.getTimelinePage).mockResolvedValue({
    entries: [
      entry("2026-09-22", "Threshold run", { planDayId: "pd-missed", status: "missed", priority: "key" }),
      entry("2026-09-25", "Strength B"),
      entry("2026-09-27", "Long run", { priority: "key", expectedDurationMin: 90, expectedRpe: 4 }),
      entry("2026-09-23", "Rest", { priority: undefined }),
    ],
    nextCursor: null,
  });
  vi.mocked(storage.plans.applyPlanDayRecovery).mockImplementation(async (_id, _user, write) => ({
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
    expect(storage.timeline.getTimelinePage).toHaveBeenCalledWith(USER, { limit: 60 });
  });

  it("refuses a day that isn't missed, a rest day, and someone else's day", async () => {
    vi.mocked(storage.plans.getPlanDay).mockResolvedValueOnce({ ...missedDay, status: "completed" });
    await expect(getMissedSessionRecoveryPreview(USER, "pd-missed")).rejects.toMatchObject({ status: 409 });

    vi.mocked(storage.plans.getPlanDay).mockResolvedValueOnce({ ...missedDay, focus: "Rest", mainWorkout: "Rest" });
    await expect(getMissedSessionRecoveryPreview(USER, "pd-missed")).rejects.toMatchObject({
      status: 409,
      message: "Rest days don't need recovering.",
    });

    vi.mocked(storage.plans.getPlanDay).mockResolvedValueOnce(undefined);
    await expect(getMissedSessionRecoveryPreview(USER, "pd-missed")).rejects.toMatchObject({ status: 404 });
  });

  it("counts a past day the sweep has not reached yet as missed, but not one an absence excuses", async () => {
    vi.mocked(storage.plans.getPlanDay).mockResolvedValueOnce({ ...missedDay, status: "planned" });
    await expect(getMissedSessionRecoveryPreview(USER, "pd-missed")).resolves.toMatchObject({ planDayId: "pd-missed" });

    vi.mocked(storage.timelineAnnotations.list).mockResolvedValueOnce([
      { startDate: "2026-09-21", endDate: "2026-09-23" } as never,
    ]);
    await expect(getMissedSessionRecoveryPreview(USER, "pd-missed")).rejects.toMatchObject({ status: 409 });
  });
});

describe("applyMissedSessionRecovery", () => {
  it("folds the session into the chosen day, remembering where it was missed", async () => {
    const day = await applyMissedSessionRecovery(USER, "pd-missed", { action: "fold", targetDate: "2026-09-24" });

    expect(storage.plans.applyPlanDayRecovery).toHaveBeenCalledWith("pd-missed", USER, {
      guard: { statuses: ["missed"], scheduledDate: "2026-09-22", recovery: null },
      update: {
        scheduledDate: "2026-09-24",
        status: "planned",
        recovery: "folded",
        missedOn: "2026-09-22",
        skipReason: null,
      },
    });
    expect(day).toMatchObject({ scheduledDate: "2026-09-24", recovery: "folded" });
    expect(enqueueAutoCoachInBackground).toHaveBeenCalledWith(USER, "plan-day-rescheduled");
  });

  it("shortens it by dropping the last intervals, leaving the notes alone when the table shows the cut", async () => {
    await applyMissedSessionRecovery(USER, "pd-missed", { action: "shorten", targetDate: "2026-09-26" });

    const write = vi.mocked(storage.plans.applyPlanDayRecovery).mock.calls[0]?.[2];
    expect(write?.update).toMatchObject({ scheduledDate: "2026-09-26", status: "planned", recovery: "shortened" });
    expect(write?.update).not.toHaveProperty("notes");
    expect(write?.update).not.toHaveProperty("expectedDurationMin");
    expect(write?.deleteSetIds).toEqual(["set-4", "set-5"]);
  });

  it("pins the length and adds an instruction when there is no table to cut", async () => {
    vi.mocked(storage.workouts.getExerciseSetsByPlanDay).mockResolvedValue([]);
    vi.mocked(storage.plans.getPlanDay).mockResolvedValue({ ...missedDay, expectedDurationMin: 50, notes: "Hold 4:10/km" });

    await applyMissedSessionRecovery(USER, "pd-missed", { action: "shorten", targetDate: "2026-09-24" });

    const write = vi.mocked(storage.plans.applyPlanDayRecovery).mock.calls[0]?.[2];
    expect(write?.update).toMatchObject({
      expectedDurationMin: 30,
      notes: "Shortened after it was missed on Tue 22 Sep: do about 60% of it.\nHold 4:10/km",
    });
  });

  it("refuses a day the preview would not offer", async () => {
    await expect(
      applyMissedSessionRecovery(USER, "pd-missed", { action: "fold", targetDate: "2026-10-20" }),
    ).rejects.toMatchObject({ status: 400 });
    expect(storage.plans.applyPlanDayRecovery).not.toHaveBeenCalled();
  });

  it("lets it go without moving it, and writes the status a not-yet-swept day is missing", async () => {
    vi.mocked(storage.plans.getPlanDay).mockResolvedValue({ ...missedDay, status: "planned" });

    await applyMissedSessionRecovery(USER, "pd-missed", { action: "let_go" });

    expect(storage.plans.applyPlanDayRecovery).toHaveBeenCalledWith("pd-missed", USER, {
      guard: { statuses: ["planned"], scheduledDate: "2026-09-22", recovery: null },
      update: { status: "missed", recovery: "let_go" },
    });
    expect(enqueueAutoCoachInBackground).not.toHaveBeenCalled();
  });

  it("reopens only a let-go", async () => {
    await expect(applyMissedSessionRecovery(USER, "pd-missed", { action: "reopen" })).rejects.toMatchObject({
      status: 409,
    });
    // Left behind on a day that was logged and then unlogged: not a let-go the timeline shows.
    vi.mocked(storage.plans.getPlanDay).mockResolvedValueOnce({ ...missedDay, status: "planned", recovery: "let_go" });
    await expect(applyMissedSessionRecovery(USER, "pd-missed", { action: "reopen" })).rejects.toMatchObject({
      status: 409,
    });

    vi.mocked(storage.plans.getPlanDay).mockResolvedValue({ ...missedDay, recovery: "let_go" });
    await applyMissedSessionRecovery(USER, "pd-missed", { action: "reopen" });
    expect(storage.plans.applyPlanDayRecovery).toHaveBeenCalledWith("pd-missed", USER, {
      guard: { statuses: ["missed"], scheduledDate: "2026-09-22", recovery: "let_go" },
      update: { recovery: null },
    });
  });

  it("turns a decision made against a stale preview into a conflict", async () => {
    vi.mocked(storage.plans.applyPlanDayRecovery).mockResolvedValue({ outcome: "conflict" });

    await expect(applyMissedSessionRecovery(USER, "pd-missed", { action: "let_go" })).rejects.toMatchObject({
      status: 409,
    });
  });
});
