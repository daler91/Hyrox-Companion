import type { TrainingOverview } from "@shared/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateJsonText } from "../../ai/providers";
import { storage } from "../../storage";
import { checkAiBudget } from "../aiUsageService";
import {
  coversOverviewRange,
  generateOverviewAnalysis,
  generateOverviewAnalysisIfAllowed,
  overviewRangeSchema,
} from "../overviewAnalysisService";
import { assembleTrainingOverview } from "../trainingOverviewLoader";

vi.mock("../../storage", () => ({
  storage: {
    users: { getUser: vi.fn() },
    analyticsResults: { get: vi.fn() },
  },
}));
vi.mock("../../ai/providers", () => ({ generateJsonText: vi.fn() }));
vi.mock("../aiUsageService", () => ({ checkAiBudget: vi.fn() }));
vi.mock("../trainingOverviewLoader", () => ({ assembleTrainingOverview: vi.fn() }));
vi.mock("../../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

/** Enough history for the RPE/duration chart, so the model is asked. */
function overviewWithRpe(): TrainingOverview {
  const week = (weekStart: string, avgRpe: number) => ({
    weekStart,
    workoutCount: 3,
    totalDuration: 180,
    avgRpe,
    runningMeters: 0,
    categoryBreakdown: {},
    workoutsWithDuration: 3,
    rpeCount: 3,
  });
  return {
    weeklySummaries: [week("2026-09-21", 7.4), week("2026-09-28", 7.8)],
    workoutDates: [],
    categoryTotals: {},
    stationCoverage: [],
    movementPatternCoverage: [],
    muscleGroupCoverage: [],
    currentStreak: 0,
    weeklyCompletedWorkouts: 0,
    weeklyGoal: 5,
    currentStats: { avgRpe: 7.6, avgDuration: 60 },
    trainingLoad: { trend: [], activeRestrictions: [] },
  } as unknown as TrainingOverview;
}

function promptPayload(): { range: string } {
  const [request] = vi.mocked(generateJsonText).mock.calls[0];
  return JSON.parse(request.messages[0].content) as { range: string };
}

// AI31 (CODEBASE_ANALYSIS_2026-10-03): the analysis read the whole history,
// with today in UTC, beside charts showing the selected range.
describe("generateOverviewAnalysis — the selected range", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 23:30 UTC on the 5th is already the 6th in Sydney.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T23:30:00Z"));
    vi.mocked(storage.users.getUser).mockResolvedValue({
      userTimezone: "Australia/Sydney",
    } as never);
    vi.mocked(assembleTrainingOverview).mockResolvedValue(overviewWithRpe());
    vi.mocked(generateJsonText).mockResolvedValue({
      text: JSON.stringify({ sections: { rpeDuration: "RPE is holding near 7.6." } }),
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the same window as the charts, ending on the athlete's today", async () => {
    const result = await generateOverviewAnalysis("user-1", undefined, 30);

    // 30 days ending today inclusive, as the Analytics page builds it.
    expect(assembleTrainingOverview).toHaveBeenCalledWith("user-1", "2026-09-07", "2026-10-06");
    expect(promptPayload().range).toBe("the last 30 days");
    expect(result).toMatchObject({
      rangeDays: 30,
      sections: { rpeDuration: "RPE is holding near 7.6." },
    });
  });

  it("defaults to the page's 90 days", async () => {
    const result = await generateOverviewAnalysis("user-1");

    expect(assembleTrainingOverview).toHaveBeenCalledWith("user-1", "2026-07-09", "2026-10-06");
    expect(result.rangeDays).toBe(90);
  });

  it("reads all time up to the athlete's today for the 'all' range", async () => {
    const result = await generateOverviewAnalysis("user-1", undefined, null);

    expect(assembleTrainingOverview).toHaveBeenCalledWith("user-1", undefined, "2026-10-06");
    expect(promptPayload().range).toBe("all time");
    expect(result.rangeDays).toBeNull();
  });

  it("records the range on an empty result too", async () => {
    vi.mocked(assembleTrainingOverview).mockResolvedValue({
      ...overviewWithRpe(),
      weeklySummaries: [],
    });

    const result = await generateOverviewAnalysis("user-1", undefined, 180);

    expect(generateJsonText).not.toHaveBeenCalled();
    expect(result).toMatchObject({ sections: {}, rangeDays: 180 });
  });

  describe("the nightly refresh", () => {
    beforeEach(() => {
      vi.mocked(storage.users.getUser).mockResolvedValue({
        aiCoachEnabled: true,
        userTimezone: "Australia/Sydney",
      } as never);
      vi.mocked(checkAiBudget).mockResolvedValue({ allowed: true } as never);
    });

    // A legacy row (stored before ranges existed) has no rangeDays field.
    const storedPayload = (extra: { rangeDays?: number | null }) =>
      vi.mocked(storage.analyticsResults.get).mockResolvedValue({
        payload: { sections: {}, generatedAt: "2026-10-01T00:00:00Z", ...extra },
      } as never);

    it("keeps the range the athlete last generated", async () => {
      storedPayload({ rangeDays: 30 });
      const outcome = await generateOverviewAnalysisIfAllowed("user-1");

      expect(outcome).toMatchObject({ ok: true, result: { rangeDays: 30 } });
      expect(assembleTrainingOverview).toHaveBeenCalledWith("user-1", "2026-09-07", "2026-10-06");
    });

    it("keeps an all-time analysis all-time", async () => {
      storedPayload({ rangeDays: null });
      const outcome = await generateOverviewAnalysisIfAllowed("user-1");

      expect(outcome).toMatchObject({ ok: true, result: { rangeDays: null } });
    });

    it("moves an analysis stored before ranges existed, or none, to the page's default", async () => {
      storedPayload({});
      expect(await generateOverviewAnalysisIfAllowed("user-1")).toMatchObject({
        ok: true,
        result: { rangeDays: 90 },
      });

      vi.mocked(storage.analyticsResults.get).mockReset();
      expect(await generateOverviewAnalysisIfAllowed("user-1")).toMatchObject({
        ok: true,
        result: { rangeDays: 90 },
      });
    });
  });
});

describe("overviewRangeSchema", () => {
  it("reads the Analytics page's range values", () => {
    expect(overviewRangeSchema.parse("all")).toBeNull();
    expect(overviewRangeSchema.parse("90")).toBe(90);
    expect(overviewRangeSchema.parse("365")).toBe(365);
  });

  it.each(["0", "-30", "7.5", "367", "ninety", ""])("rejects %j", (value) => {
    expect(overviewRangeSchema.safeParse(value).success).toBe(false);
  });
});

describe("coversOverviewRange", () => {
  it("matches only the range a stored analysis was generated for", () => {
    expect(coversOverviewRange({ rangeDays: 90 }, 90)).toBe(true);
    expect(coversOverviewRange({ rangeDays: 90 }, 30)).toBe(false);
    expect(coversOverviewRange({ rangeDays: null }, null)).toBe(true);
    expect(coversOverviewRange({ rangeDays: null }, 90)).toBe(false);
  });

  it("shows an analysis stored before ranges existed on any range until it is refreshed", () => {
    expect(coversOverviewRange({}, null)).toBe(true);
    expect(coversOverviewRange({}, 90)).toBe(true);
    expect(coversOverviewRange({}, 30)).toBe(true);
  });
});
