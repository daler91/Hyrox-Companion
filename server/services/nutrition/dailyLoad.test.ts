import { beforeEach, describe, expect, it, vi } from "vitest";

import { storage } from "../../storage";
import { calculateTrainingLoad } from "../trainingLoadService";
import { fetchTrainingLoadWindow, fetchTrainingLoadWindows } from "./dailyLoad";

vi.mock("../../storage", () => ({
  storage: {
    analytics: {
      getWorkoutLogsByDateRange: vi.fn().mockResolvedValue([]),
      getAllExerciseSetsWithDates: vi.fn().mockResolvedValue([]),
      getExerciseLoadTags: vi.fn().mockResolvedValue([]),
    },
    users: { getUser: vi.fn() },
    timeline: { getUpcomingPlannedDays: vi.fn() },
    plans: { getActivePlan: vi.fn() },
  },
}));

// EWMA_WARMUP_DAYS is a real value, not a stub: the fetch range is derived from
// it, and one assertion below pins that range (audit H21).
vi.mock("../trainingLoadService", () => ({ calculateTrainingLoad: vi.fn(), EWMA_WARMUP_DAYS: 56 }));

/** A minimal DailyTrainingLoad row — only the fields the window reads. */
function load(date: string, utss: number, extra: Record<string, unknown> = {}) {
  return { date, utss, acuteEwma: null, chronicEwma: null, tsb: null, ...extra } as never;
}

const DATE = "2026-06-22";

describe("fetchTrainingLoadWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.users.getUser).mockResolvedValue({ weightUnit: "kg", distanceUnit: "km" } as never);
    vi.mocked(storage.timeline.getUpcomingPlannedDays).mockResolvedValue([]);
    vi.mocked(storage.plans.getActivePlan).mockResolvedValue(undefined);
    vi.mocked(calculateTrainingLoad).mockReturnValue({ dailyLoads: [] } as never);
  });

  it("builds a trailing recent-load window that includes rest days as 0", async () => {
    vi.mocked(calculateTrainingLoad).mockReturnValue({
      dailyLoads: [
        load("2026-06-20", 80), // two days ago — a hard session
        load(DATE, 0, { acuteEwma: 60, tsb: -10 }), // today is a fatigued rest day
      ],
    } as never);

    const w = await fetchTrainingLoadWindow("u1", DATE, { includeFuture: false });

    expect(w.dayUtss).toBe(0);
    expect(w.recentLoads).toHaveLength(7);
    // index 5 == day-2 (loop pushes day-7 first … day-1 last).
    expect(w.recentLoads[5]).toBe(80);
    expect(w.recentLoads.filter((v) => v === 0)).toHaveLength(6);
    expect(w.acuteEwma).toBe(60);
    expect(w.tsb).toBe(-10);
    // The EWMAs start at the first log in whatever range is fetched, so the
    // fetch must cover the warmup even though recentLoads only reads 7 days.
    // Fetching 7 handed the effective target a 28-day baseline built from one
    // week: 26.1 against a true 107.2 for a tapering athlete (audit H21).
    // It starts on the 28-day grid boundary at or before the 56-day warmup
    // (2026-04-27), so the same day reads the same history in any range (C31).
    expect(storage.analytics.getWorkoutLogsByDateRange).toHaveBeenCalledWith(
      "u1",
      "2026-04-20",
      DATE,
    );
    expect(calculateTrainingLoad).toHaveBeenCalledWith(
      [],
      [],
      [],
      expect.objectContaining({ currentDate: DATE, historyFrom: "2026-04-20" }),
    );
    // No future fetches when includeFuture is false.
    expect(storage.timeline.getUpcomingPlannedDays).not.toHaveBeenCalled();
    expect(w.upcoming).toEqual([]);
    expect(w.phase).toBeNull();
  });

  it("estimates upcoming planned load within the horizon and drops far-off sessions", async () => {
    vi.mocked(calculateTrainingLoad).mockReturnValue({ dailyLoads: [load(DATE, 50)] } as never);
    vi.mocked(storage.timeline.getUpcomingPlannedDays).mockResolvedValue([
      { date: "2026-06-23", expectedDurationMin: 60, expectedRpe: 8, structureBlocks: [], exerciseSets: [] },
      { date: "2026-06-26", expectedDurationMin: 90, expectedRpe: 9, structureBlocks: [], exerciseSets: [] },
    ] as never);

    const w = await fetchTrainingLoadWindow("u1", DATE, { includeFuture: true });

    // Only the next-day session is within the 2-day pre-load horizon.
    expect(w.upcoming).toEqual([{ daysAhead: 1, plannedUtss: 112.8 }]); // 60 × (0.6 + 0.8² × 2)
  });

  it("derives the plan phase + days-until-race from the active plan", async () => {
    vi.mocked(calculateTrainingLoad).mockReturnValue({ dailyLoads: [load(DATE, 40)] } as never);
    vi.mocked(storage.plans.getActivePlan).mockResolvedValue({
      startDate: "2026-05-01",
      endDate: "2026-08-01",
      raceDate: "2026-07-02",
      totalWeeks: 8,
    } as never);

    const w = await fetchTrainingLoadWindow("u1", DATE, { includeFuture: true });

    // ~7 weeks into an 8-week plan ⇒ race week; race is 10 days out.
    expect(w.phase).toBe("race_week");
    expect(w.daysUntilRace).toBe(10);
  });
});

// C31 (CODEBASE_ANALYSIS_2026-10-03): the daily summary and the fuelling range
// both build windows here, and a day's window must not depend on the range
// that asked for it. Each day's history starts on a fixed 28-day grid, at
// least the 56-day warmup back, and one engine pass serves a whole boundary.
describe("fetchTrainingLoadWindows", () => {
  const LOGS = [
    { id: "w-apr", date: "2026-04-30" },
    { id: "w-jun", date: "2026-06-19" },
    { id: "w-jul", date: "2026-07-29" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.users.getUser).mockResolvedValue({ weightUnit: "kg", distanceUnit: "km" } as never);
    vi.mocked(storage.analytics.getWorkoutLogsByDateRange).mockResolvedValue(LOGS as never);
    vi.mocked(storage.analytics.getAllExerciseSetsWithDates).mockResolvedValue([
      { workoutLogId: "w-apr", date: "2026-04-30" },
      { workoutLogId: "w-jul", date: "2026-07-29" },
    ] as never);
    const scoreAsOf = (...args: unknown[]) => {
      const { currentDate } = args[3] as { currentDate: string };
      return { dailyLoads: [load(currentDate, currentDate === "2026-07-30" ? 70 : 40)] };
    };
    vi.mocked(calculateTrainingLoad).mockImplementation(scoreAsOf as never);
  });

  it("reads the span once and scores each grid boundary's days from that boundary", async () => {
    const dates = ["2026-07-30", "2026-06-20", "2026-06-22"];
    const windows = await fetchTrainingLoadWindows("u1", dates, { includeFuture: false });

    // One read, from the first day's history start to the last day.
    expect(storage.analytics.getWorkoutLogsByDateRange).toHaveBeenCalledTimes(1);
    expect(storage.analytics.getWorkoutLogsByDateRange).toHaveBeenCalledWith(
      "u1",
      "2026-04-20",
      "2026-07-30",
    );
    // June 20 and 22 share the 2026-04-20 boundary; July 30's is 2026-05-18.
    expect(calculateTrainingLoad).toHaveBeenCalledTimes(2);
    expect(calculateTrainingLoad).toHaveBeenNthCalledWith(
      1,
      [LOGS[0], LOGS[1]],
      [{ workoutLogId: "w-apr", date: "2026-04-30" }],
      [],
      expect.objectContaining({ currentDate: "2026-06-22", historyFrom: "2026-04-20" }),
    );
    // The April log predates July 30's history start, so it is not fed in.
    expect(calculateTrainingLoad).toHaveBeenNthCalledWith(
      2,
      [LOGS[1], LOGS[2]],
      [{ workoutLogId: "w-jul", date: "2026-07-29" }],
      [],
      expect.objectContaining({ currentDate: "2026-07-30", historyFrom: "2026-05-18" }),
    );
    expect([...windows.keys()]).toEqual(["2026-06-20", "2026-06-22", "2026-07-30"]);
    expect(windows.get("2026-07-30")?.dayUtss).toBe(70);
  });

  it("feeds a day the same history whether it is asked for alone or within a range", async () => {
    await fetchTrainingLoadWindows("u1", ["2026-06-22"], { includeFuture: false });
    const alone = vi.mocked(calculateTrainingLoad).mock.calls[0];
    vi.mocked(calculateTrainingLoad).mockClear();

    // A wider range: June 1 starts an earlier boundary (2026-03-23), and the
    // read now starts there too, but June 22 is still scored from its own.
    await fetchTrainingLoadWindows("u1", ["2026-06-01", "2026-06-22"], { includeFuture: false });
    expect(storage.analytics.getWorkoutLogsByDateRange).toHaveBeenLastCalledWith(
      "u1",
      "2026-03-23",
      "2026-06-22",
    );
    const inRange = vi
      .mocked(calculateTrainingLoad)
      .mock.calls.find(([, , , opts]) => opts?.currentDate === "2026-06-22");

    expect(alone?.[3]).toMatchObject({ currentDate: "2026-06-22", historyFrom: "2026-04-20" });
    expect(inRange?.[3]).toMatchObject({ currentDate: "2026-06-22", historyFrom: "2026-04-20" });
    expect(inRange?.[0]).toEqual(alone?.[0]);
    expect(inRange?.[1]).toEqual(alone?.[1]);
  });

  it("reads nothing when no day needs a window", async () => {
    const none = await fetchTrainingLoadWindows("u1", [], { includeFuture: true });
    expect(none).toEqual(new Map());
    expect(storage.analytics.getWorkoutLogsByDateRange).not.toHaveBeenCalled();
    expect(storage.timeline.getUpcomingPlannedDays).not.toHaveBeenCalled();
  });
});
