import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IStorage } from "../storage";
import { buildWeeklyReview, isWeekParamValid, listPersonalRecordsInRange, resolveReviewWeek } from "./weeklyReviewService";

vi.mock("./analyticsService", () => ({
  // The PR calculation has its own suite; here it is a seam, so tests can hand
  // the review a record set without constructing exercise sets.
  calculatePersonalRecords: vi.fn(() => ({})),
}));

// Wednesday of the week opening Mon 2026-06-15. The completed week before it is
// Mon 2026-06-08 → Sun 2026-06-14.
const WEDNESDAY = new Date("2026-06-17T12:00:00Z");
const LAST_WEEK = { start: "2026-06-08", end: "2026-06-14" };

function log(overrides: Record<string, unknown> = {}) {
  return {
    id: "wl-1",
    date: "2026-06-10",
    focus: "Threshold Intervals",
    duration: 60,
    rpe: 7,
    source: "manual",
    planDayId: "pd-1",
    compliancePct: 92,
    matchedSetCount: 11,
    addedSetCount: 1,
    removedSetCount: 0,
    ...overrides,
  };
}

function planDay(overrides: Record<string, unknown> = {}) {
  return {
    id: "pd-1",
    date: "2026-06-10",
    focus: "Threshold Intervals",
    status: "completed",
    skipReason: null,
    planName: "12-week build",
    ...overrides,
  };
}

interface StorageFixture {
  logs?: ReturnType<typeof log>[];
  planDays?: ReturnType<typeof planDay>[];
  priorLogs?: ReturnType<typeof log>[];
  priorPlanDays?: ReturnType<typeof planDay>[];
  annotations?: Record<string, unknown>[];
  user?: Record<string, unknown> | null;
  intents?: Map<string, string | null>;
}

function storageFor(fixture: StorageFixture = {}) {
  const {
    logs = [],
    planDays = [],
    priorLogs = [],
    priorPlanDays = [],
    annotations = [],
    user = { weeklyGoal: 4, userTimezone: "UTC" },
  } = fixture;

  // Both range readers are called twice — current week then prior week — so the
  // fixtures are keyed on the range rather than on call order.
  const getWorkoutLogsByDateRange = vi.fn((_userId: string, from: string) =>
    Promise.resolve(from === LAST_WEEK.start ? logs : priorLogs),
  );
  const getPlanDaysByDateRange = vi.fn((_userId: string, from: string) =>
    Promise.resolve(from === LAST_WEEK.start ? planDays : priorPlanDays),
  );

  return {
    users: { getUser: vi.fn().mockResolvedValue(user) },
    analytics: {
      getWorkoutLogsByDateRange,
      getPlanDaysByDateRange,
      getExerciseSetsForPersonalRecords: vi.fn().mockResolvedValue([]),
    },
    timelineAnnotations: { list: vi.fn().mockResolvedValue(annotations) },
    weeklyReviews: { getIntents: vi.fn().mockResolvedValue(fixture.intents ?? new Map()) },
  } as unknown as IStorage;
}

describe("resolveReviewWeek", () => {
  it("defaults to the most recently completed week", () => {
    expect(resolveReviewWeek(WEDNESDAY, "UTC")).toEqual({
      week: { weekStart: LAST_WEEK.start, weekEnd: LAST_WEEK.end },
      isCurrentWeek: false,
    });
  });

  it("anchors any date inside the requested week to that week", () => {
    // A link to a Thursday must open its week, not 400 for not being a Monday.
    for (const date of ["2026-06-15", "2026-06-18", "2026-06-21"]) {
      expect(resolveReviewWeek(WEDNESDAY, "UTC", date).week).toEqual({
        weekStart: "2026-06-15",
        weekEnd: "2026-06-21",
      });
    }
  });

  it("flags the in-progress week so totals can read as 'so far'", () => {
    expect(resolveReviewWeek(WEDNESDAY, "UTC", "2026-06-17").isCurrentWeek).toBe(true);
    expect(resolveReviewWeek(WEDNESDAY, "UTC", LAST_WEEK.start).isCurrentWeek).toBe(false);
  });

  it("resolves the current week against the athlete's timezone", () => {
    // 23:30 Sunday UTC is already Monday in Sydney, so the two athletes are in
    // different weeks at the same instant.
    const instant = new Date("2026-06-14T23:30:00Z");
    expect(resolveReviewWeek(instant, "Australia/Sydney").week.weekStart).toBe("2026-06-08");
    expect(resolveReviewWeek(instant, "UTC").week.weekStart).toBe("2026-06-01");
  });
});

describe("isWeekParamValid", () => {
  it("accepts real calendar dates", () => {
    expect(isWeekParamValid("2026-06-15")).toBe(true);
    expect(isWeekParamValid("2024-02-29")).toBe(true);
  });

  it("rejects a well-formed but impossible date", () => {
    // The regex-only schema used elsewhere passes these, and they then roll
    // forward silently into a week the athlete never asked for.
    expect(isWeekParamValid("2026-02-31")).toBe(false);
    expect(isWeekParamValid("2026-13-01")).toBe(false);
    expect(isWeekParamValid("2023-02-29")).toBe(false);
  });

  it("rejects malformed and non-string inputs", () => {
    expect(isWeekParamValid("2026-6-1")).toBe(false);
    expect(isWeekParamValid("last-week")).toBe(false);
    expect(isWeekParamValid(undefined)).toBe(false);
    expect(isWeekParamValid(20260615)).toBe(false);
  });
});

describe("listPersonalRecordsInRange", () => {
  const prs = {
    "Back Squat": {
      category: "strength",
      customLabel: null,
      maxWeight: { value: 140, date: "2026-06-10", workoutLogId: "wl-1" },
      estimated1RM: { value: 165, date: "2026-05-02", workoutLogId: "wl-0" },
    },
    "Wall Balls": {
      category: "functional",
      customLabel: null,
      bestTime: { value: 240, date: "2026-06-14", workoutLogId: "wl-2" },
    },
  };

  it("returns the records themselves, per metric, inside the window", () => {
    const records = listPersonalRecordsInRange(prs, LAST_WEEK.start, LAST_WEEK.end);
    expect(records).toEqual([
      { exerciseName: "Back Squat", customLabel: null, category: "strength", metric: "maxWeight", value: 140, date: "2026-06-10", workoutLogId: "wl-1" },
      { exerciseName: "Wall Balls", customLabel: null, category: "functional", metric: "bestTime", value: 240, date: "2026-06-14", workoutLogId: "wl-2" },
    ]);
  });

  it("excludes bests first achieved outside the window", () => {
    // The May e1RM is still an all-time best; it is just not this week's news.
    const records = listPersonalRecordsInRange(prs, LAST_WEEK.start, LAST_WEEK.end);
    expect(records.some((r) => r.metric === "estimated1RM")).toBe(false);
  });
});

describe("buildWeeklyReview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports sessions logged and plan completions as separate numbers", async () => {
    // Three sessions logged, only one of them planned: a single rate over these
    // two sources would read 300%. This is the case the split exists for.
    const storage = storageFor({
      logs: [
        log({ id: "wl-1", planDayId: "pd-1" }),
        log({ id: "wl-2", date: "2026-06-11", planDayId: null, rpe: 5 }),
        log({ id: "wl-3", date: "2026-06-12", planDayId: null, rpe: 9 }),
      ],
      planDays: [planDay({ id: "pd-1", status: "completed" })],
    });

    const review = await buildWeeklyReview(storage, "u1", { now: WEDNESDAY });

    expect(review.current.sessionsLogged).toBe(3);
    expect(review.current.sessionsPlanned).toBe(1);
    expect(review.current.plannedCompleted).toBe(1);
    expect(review.current.plannedCompleted).toBeLessThanOrEqual(review.current.sessionsPlanned);
  });

  it("counts every plan-day status from one source", async () => {
    const storage = storageFor({
      logs: [log()],
      planDays: [
        planDay({ id: "pd-1", status: "completed" }),
        planDay({ id: "pd-2", date: "2026-06-11", status: "missed" }),
        planDay({ id: "pd-3", date: "2026-06-12", status: "skipped", skipReason: "injured" }),
        planDay({ id: "pd-4", date: "2026-06-13", status: "planned" }),
      ],
    });

    const review = await buildWeeklyReview(storage, "u1", { now: WEDNESDAY });

    expect(review.current).toMatchObject({
      sessionsPlanned: 4,
      plannedCompleted: 1,
      missed: 1,
      skipped: 1,
      outstanding: 1,
    });
  });

  it("lists what did not happen, with the skip reason, and omits completions", async () => {
    const storage = storageFor({
      planDays: [
        planDay({ id: "pd-1", status: "completed" }),
        planDay({ id: "pd-2", date: "2026-06-11", status: "skipped", skipReason: "injured", focus: "Sled Push" }),
      ],
    });

    const review = await buildWeeklyReview(storage, "u1", { now: WEDNESDAY });

    // The completed day is already in `sessions` with far more detail.
    expect(review.plannedDays).toEqual([
      { planDayId: "pd-2", date: "2026-06-11", focus: "Sled Push", status: "skipped", skipReason: "injured", planName: "12-week build" },
    ]);
  });

  it("carries the adherence add/drop detail per session", async () => {
    const storage = storageFor({ logs: [log({ addedSetCount: 2, removedSetCount: 3, compliancePct: 71 })] });

    const review = await buildWeeklyReview(storage, "u1", { now: WEDNESDAY });

    expect(review.sessions[0]).toMatchObject({ compliancePct: 71, addedSetCount: 2, removedSetCount: 3 });
  });

  it("compares against the week before", async () => {
    const storage = storageFor({
      logs: [log({ id: "wl-1", duration: 60, rpe: 8 }), log({ id: "wl-2", date: "2026-06-11", duration: 30, rpe: 6 })],
      priorLogs: [log({ id: "wl-0", date: "2026-06-03", duration: 45, rpe: 7 })],
    });

    const review = await buildWeeklyReview(storage, "u1", { now: WEDNESDAY });

    expect(review.previous.sessionsLogged).toBe(1);
    expect(review.deltas).toEqual({ sessionsLogged: 1, totalDurationMin: 45, avgRpe: 0 });
  });

  it("leaves the RPE delta null when a week has no RPE at all", async () => {
    // Otherwise "no data" renders identically to "effort collapsed".
    const storage = storageFor({
      logs: [log({ rpe: 8 })],
      priorLogs: [log({ id: "wl-0", date: "2026-06-03", rpe: null })],
    });

    const review = await buildWeeklyReview(storage, "u1", { now: WEDNESDAY });

    expect(review.previous.avgRpe).toBeNull();
    expect(review.deltas.avgRpe).toBeNull();
  });

  it("keeps annotations that overlap the week, not just those inside it", async () => {
    const storage = storageFor({
      annotations: [
        { id: "a1", type: "injury", startDate: "2026-05-25", endDate: "2026-06-20", note: "Achilles" },
        { id: "a2", type: "travel", startDate: "2026-07-01", endDate: "2026-07-05", note: null },
      ],
    });

    const review = await buildWeeklyReview(storage, "u1", { now: WEDNESDAY });

    // A three-week injury covers this week without starting or ending in it.
    expect(review.annotations.map((a) => a.id)).toEqual(["a1"]);
  });

  it("flags the planless athlete so no completion framing is applied", async () => {
    const storage = storageFor({ logs: [log({ planDayId: null })], planDays: [] });

    const review = await buildWeeklyReview(storage, "u1", { now: WEDNESDAY });

    expect(review.hasPlan).toBe(false);
    expect(review.current.sessionsLogged).toBe(1);
    expect(review.current.sessionsPlanned).toBe(0);
  });

  it("reads as an empty week rather than a failure when nothing was logged or planned", async () => {
    const review = await buildWeeklyReview(storageFor(), "u1", { now: WEDNESDAY });

    expect(review.hasPlan).toBe(false);
    expect(review.sessions).toEqual([]);
    expect(review.plannedDays).toEqual([]);
    expect(review.current.sessionsLogged).toBe(0);
    expect(review.deltas.avgRpe).toBeNull();
  });

  it("reports the timezone it actually resolved the week in", async () => {
    // A stale users.userTimezone must degrade to UTC rather than 500, and the
    // payload must not then label a UTC week with the unusable zone.
    const storage = storageFor({ user: { weeklyGoal: 4, userTimezone: "Mars/Olympus_Mons" } });

    const review = await buildWeeklyReview(storage, "u1", { now: WEDNESDAY });

    expect(review.timezone).toBe("UTC");
    expect(review.weekStart).toBe(LAST_WEEK.start);
  });

  it("queries exactly the requested week and the one before it", async () => {
    const storage = storageFor();

    await buildWeeklyReview(storage, "u1", { now: WEDNESDAY });

    expect(storage.analytics.getWorkoutLogsByDateRange).toHaveBeenCalledWith("u1", "2026-06-08", "2026-06-14");
    expect(storage.analytics.getWorkoutLogsByDateRange).toHaveBeenCalledWith("u1", "2026-06-01", "2026-06-07");
    expect(storage.analytics.getPlanDaysByDateRange).toHaveBeenCalledWith("u1", "2026-06-08", "2026-06-14");
    expect(storage.analytics.getPlanDaysByDateRange).toHaveBeenCalledWith("u1", "2026-06-01", "2026-06-07");
  });

  it("falls back to the default weekly goal when the user row is missing", async () => {
    const review = await buildWeeklyReview(storageFor({ user: null }), "u1", { now: WEDNESDAY });

    expect(review.weeklyGoal).toBe(5);
    expect(review.timezone).toBe("UTC");
  });
});

describe("buildWeeklyReview — intent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns this week's intent to edit and last week's to show back", async () => {
    const storage = storageFor({
      intents: new Map([
        [LAST_WEEK.start, "three runs, and actually take the rest day"],
        ["2026-06-01", "get the sled work in"],
      ]),
    });

    const review = await buildWeeklyReview(storage, "u1", { now: WEDNESDAY });

    expect(review.intent).toBe("three runs, and actually take the rest day");
    expect(review.previousIntent).toBe("get the sled work in");
  });

  it("asks for both weeks in one round trip", async () => {
    const storage = storageFor();

    await buildWeeklyReview(storage, "u1", { now: WEDNESDAY });

    expect(storage.weeklyReviews.getIntents).toHaveBeenCalledWith("u1", [LAST_WEEK.start, "2026-06-01"]);
  });

  it("is null on both sides when the athlete has never written one", async () => {
    const review = await buildWeeklyReview(storageFor(), "u1", { now: WEDNESDAY });

    expect(review.intent).toBeNull();
    expect(review.previousIntent).toBeNull();
  });

  it("treats a cleared intent as absent rather than empty", async () => {
    // The row survives a clear (updatedAt stays meaningful), holding null.
    const storage = storageFor({ intents: new Map([[LAST_WEEK.start, null]]) });

    const review = await buildWeeklyReview(storage, "u1", { now: WEDNESDAY });

    expect(review.intent).toBeNull();
  });
});
