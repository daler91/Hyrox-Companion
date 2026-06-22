import { beforeEach, describe, expect, it, vi } from "vitest";

import { storage } from "../../storage";
import { calculateTrainingLoad } from "../trainingLoadService";
import { fetchTrainingLoadWindow } from "./dailyLoad";

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

vi.mock("../trainingLoadService", () => ({ calculateTrainingLoad: vi.fn() }));

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
