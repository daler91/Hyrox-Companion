import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IStorage } from "../../storage";
import { runAnalyticsRecomputeScan } from "../analyticsRecomputeScheduler";

// Mock the queue module so importing the scheduler doesn't construct pg-boss and
// so we can assert what gets enqueued.
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("../../queue", () => ({
  queue: { send: sendMock },
  DEFAULT_JOB_OPTIONS: { retryLimit: 3, retryBackoff: true, expireInMinutes: 60 },
  RECOMPUTE_ANALYTICS_QUEUE: "recompute-analytics",
}));

type StoredRow = {
  recomputedOn: string | null;
  lastWorkoutDateAtGeneration: string | null;
  /**
   * Row count at generation (audit L16). Omitted here means the row predates
   * the column, which computeStale answers with the date-only test — so the
   * date-anchored cases below keep testing exactly what they always did.
   */
  entryCountAtGeneration?: number | null;
};

type Feature = "coach_insights" | "race_prediction" | "nutrition_insights" | "overview_analysis";

interface FakeData {
  engagedUserIds: string[];
  users: Record<string, { userTimezone: string } | undefined>;
  latestWorkoutDate: Record<string, string | null>;
  /** Total workout logs — the other half of the staleness anchor (audit L16). */
  workoutCount?: Record<string, number>;
  /** Latest food-log date — the staleness anchor for nutrition_insights. */
  latestNutritionLogDate?: Record<string, string | null>;
  /** Total food-log entries, the nutrition half of the same anchor. */
  nutritionLogCount?: Record<string, number>;
  rows: Record<string, Partial<Record<Feature, StoredRow>>>;
}

function makeStorage(data: FakeData): IStorage {
  return {
    analyticsResults: {
      listEngagedUserIds: vi.fn(async () => data.engagedUserIds),
      get: vi.fn(async (userId: string, feature: Feature) => data.rows[userId]?.[feature]),
      getMany: vi.fn(async (userIds: string[]) =>
        userIds.flatMap((userId) =>
          Object.entries(data.rows[userId] ?? {}).map(([feature, row]) => ({
            // Normalize the omitted count to null explicitly: `undefined` would
            // read as "a count was recorded, and it was undefined" and mark
            // every row stale.
            entryCountAtGeneration: null,
            ...row,
            userId,
            feature,
          })),
        ),
      ),
      upsert: vi.fn(),
      markRecomputedOn: vi.fn(),
    },
    users: {
      getUser: vi.fn(async (userId: string) => data.users[userId]),
      getUsers: vi.fn(async (userIds: string[]) =>
        userIds
          .map((id) => {
            const u = data.users[id];
            return u ? { id, ...u } : undefined;
          })
          .filter((u): u is { id: string; userTimezone: string } => u !== undefined),
      ),
    },
    workouts: {
      listWorkoutLogs: vi.fn(async (userId: string) => {
        const date = data.latestWorkoutDate[userId];
        return date == null ? [] : [{ date }];
      }),
      countWorkoutLogs: vi.fn(async (userId: string) => data.workoutCount?.[userId] ?? 0),
    },
    nutrition: {
      getLatestLogDate: vi.fn(
        async (userId: string) => data.latestNutritionLogDate?.[userId] ?? null,
      ),
      countLogEntries: vi.fn(async (userId: string) => data.nutritionLogCount?.[userId] ?? 0),
    },
  } as unknown as IStorage;
}

// 00:30 UTC → local hour 0 for "UTC" users (eligible); local hour 20 for
// "America/New_York" in June (UTC-4, ineligible).
const NOW = new Date("2026-06-05T00:30:00Z");

describe("runAnalyticsRecomputeScan", () => {
  beforeEach(() => {
    sendMock.mockClear();
  });

  it("enqueues a recompute only for stale features at the user's local midnight", async () => {
    const storage = makeStorage({
      engagedUserIds: ["u1"],
      users: { u1: { userTimezone: "UTC" } },
      latestWorkoutDate: { u1: "2026-06-05" },
      rows: {
        u1: {
          coach_insights: { recomputedOn: null, lastWorkoutDateAtGeneration: "2026-06-01" }, // stale
          race_prediction: { recomputedOn: null, lastWorkoutDateAtGeneration: "2026-06-05" }, // fresh
        },
      },
    });

    const result = await runAnalyticsRecomputeScan(storage, NOW);

    expect(result).toEqual({ usersChecked: 1, enqueued: 1 });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const [queueName, payload, options] = sendMock.mock.calls[0];
    expect(queueName).toBe("recompute-analytics");
    expect(payload).toEqual({ userId: "u1", feature: "coach_insights", localDate: "2026-06-05" });
    expect(options.singletonKey).toBe("recompute:coach_insights:u1");
    expect(options.singletonSeconds).toBe(3600);
  });

  it("recomputes for a second session logged on an already-anchored day (audit L16)", async () => {
    // The athlete ran in the morning and lifted in the evening. The date the
    // result was generated against still reads 2026-06-05, so the date-only
    // test called the stored analysis fresh and the nightly scan skipped it —
    // leaving Coach Insights and the Race Prediction built on half the day.
    const storage = makeStorage({
      engagedUserIds: ["u1"],
      users: { u1: { userTimezone: "UTC" } },
      latestWorkoutDate: { u1: "2026-06-05" },
      workoutCount: { u1: 10 }, // the evening session is the 10th
      rows: {
        u1: {
          coach_insights: {
            recomputedOn: null,
            lastWorkoutDateAtGeneration: "2026-06-05",
            entryCountAtGeneration: 9,
          },
        },
      },
    });

    const result = await runAnalyticsRecomputeScan(storage, NOW);

    expect(result).toEqual({ usersChecked: 1, enqueued: 1 });
    expect(sendMock.mock.calls[0][1]).toEqual({
      userId: "u1",
      feature: "coach_insights",
      localDate: "2026-06-05",
    });
  });

  it("leaves a genuinely unchanged history alone", async () => {
    // The count must not turn the nightly scan into an unconditional recompute
    // of every engaged user — that would be an AI bill, not a fix.
    const storage = makeStorage({
      engagedUserIds: ["u1"],
      users: { u1: { userTimezone: "UTC" } },
      latestWorkoutDate: { u1: "2026-06-05" },
      workoutCount: { u1: 9 },
      rows: {
        u1: {
          coach_insights: {
            recomputedOn: null,
            lastWorkoutDateAtGeneration: "2026-06-05",
            entryCountAtGeneration: 9,
          },
        },
      },
    });

    expect(await runAnalyticsRecomputeScan(storage, NOW)).toEqual({ usersChecked: 1, enqueued: 0 });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("does not stampede on rows written before the count column existed", async () => {
    // Every stored row has a null count on the deploy that adds it. If null
    // read as zero, this scan would enqueue a recompute for the entire engaged
    // user base on one night.
    const storage = makeStorage({
      engagedUserIds: ["u1"],
      users: { u1: { userTimezone: "UTC" } },
      latestWorkoutDate: { u1: "2026-06-05" },
      workoutCount: { u1: 9 },
      rows: {
        u1: { coach_insights: { recomputedOn: null, lastWorkoutDateAtGeneration: "2026-06-05" } },
      },
    });

    expect(await runAnalyticsRecomputeScan(storage, NOW)).toEqual({ usersChecked: 1, enqueued: 0 });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("skips users whose local time is not midnight", async () => {
    const storage = makeStorage({
      engagedUserIds: ["u1"],
      users: { u1: { userTimezone: "America/New_York" } },
      latestWorkoutDate: { u1: "2026-06-05" },
      rows: {
        u1: { coach_insights: { recomputedOn: null, lastWorkoutDateAtGeneration: "2026-06-01" } },
      },
    });

    const result = await runAnalyticsRecomputeScan(storage, NOW);

    expect(result).toEqual({ usersChecked: 0, enqueued: 0 });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("skips features already recomputed today (once-per-day guard)", async () => {
    const storage = makeStorage({
      engagedUserIds: ["u1"],
      users: { u1: { userTimezone: "UTC" } },
      latestWorkoutDate: { u1: "2026-06-05" },
      rows: {
        u1: {
          coach_insights: { recomputedOn: "2026-06-05", lastWorkoutDateAtGeneration: "2026-06-01" },
        },
      },
    });

    const result = await runAnalyticsRecomputeScan(storage, NOW);

    expect(result.enqueued).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("skips features the user has never used (no stored row)", async () => {
    const storage = makeStorage({
      engagedUserIds: ["u1"],
      users: { u1: { userTimezone: "UTC" } },
      latestWorkoutDate: { u1: "2026-06-05" },
      // Only a race_prediction row exists; coach_insights is absent and must be skipped.
      rows: {
        u1: { race_prediction: { recomputedOn: null, lastWorkoutDateAtGeneration: "2026-06-01" } },
      },
    });

    const result = await runAnalyticsRecomputeScan(storage, NOW);

    expect(result.enqueued).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][1]).toEqual({
      userId: "u1",
      feature: "race_prediction",
      localDate: "2026-06-05",
    });
  });

  it("enqueues no workout-anchored jobs for users with no logged workouts", async () => {
    const storage = makeStorage({
      engagedUserIds: ["u1"],
      users: { u1: { userTimezone: "UTC" } },
      latestWorkoutDate: { u1: null },
      rows: { u1: { coach_insights: { recomputedOn: null, lastWorkoutDateAtGeneration: null } } },
    });

    const result = await runAnalyticsRecomputeScan(storage, NOW);

    expect(result.enqueued).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("anchors nutrition_insights staleness on the food-log date, not the workout date", async () => {
    const storage = makeStorage({
      engagedUserIds: ["u1"],
      users: { u1: { userTimezone: "UTC" } },
      // A workout logged after generation would WRONGLY mark nutrition stale
      // under the old single-anchor logic; the food-log anchor says fresh.
      latestWorkoutDate: { u1: "2026-06-05" },
      latestNutritionLogDate: { u1: "2026-06-01" },
      rows: {
        u1: {
          nutrition_insights: { recomputedOn: null, lastWorkoutDateAtGeneration: "2026-06-01" },
        },
      },
    });

    const result = await runAnalyticsRecomputeScan(storage, NOW);

    expect(result.enqueued).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("recomputes nutrition_insights for a meal-logging user with zero workouts", async () => {
    const storage = makeStorage({
      engagedUserIds: ["u1"],
      users: { u1: { userTimezone: "UTC" } },
      latestWorkoutDate: { u1: null }, // the old early return starved these users
      latestNutritionLogDate: { u1: "2026-06-04" },
      rows: {
        u1: {
          nutrition_insights: { recomputedOn: null, lastWorkoutDateAtGeneration: "2026-06-01" },
        },
      },
    });

    const result = await runAnalyticsRecomputeScan(storage, NOW);

    expect(result.enqueued).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][1]).toEqual({
      userId: "u1",
      feature: "nutrition_insights",
      localDate: "2026-06-05",
    });
  });
});
