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

type StoredRow = { recomputedOn: string | null; lastWorkoutDateAtGeneration: string | null };

interface FakeData {
  engagedUserIds: string[];
  users: Record<string, { userTimezone: string } | undefined>;
  latestWorkoutDate: Record<string, string | null>;
  rows: Record<string, Partial<Record<"coach_insights" | "race_prediction", StoredRow>>>;
}

function makeStorage(data: FakeData): IStorage {
  return {
    analyticsResults: {
      listEngagedUserIds: vi.fn(async () => data.engagedUserIds),
      get: vi.fn(async (userId: string, feature: "coach_insights" | "race_prediction") => data.rows[userId]?.[feature]),
      upsert: vi.fn(),
      markRecomputedOn: vi.fn(),
    },
    users: {
      getUser: vi.fn(async (userId: string) => data.users[userId]),
      getUsers: vi.fn(async (userIds: string[]) => userIds.map(id => {
        const u = data.users[id];
        return u ? { id, ...u } : undefined;
      }).filter((u): u is {id: string, userTimezone: string} => u !== undefined)),
    },
    workouts: {
      listWorkoutLogs: vi.fn(async (userId: string) => {
        const date = data.latestWorkoutDate[userId];
        return date == null ? [] : [{ date }];
      }),
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

  it("skips users whose local time is not midnight", async () => {
    const storage = makeStorage({
      engagedUserIds: ["u1"],
      users: { u1: { userTimezone: "America/New_York" } },
      latestWorkoutDate: { u1: "2026-06-05" },
      rows: { u1: { coach_insights: { recomputedOn: null, lastWorkoutDateAtGeneration: "2026-06-01" } } },
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
      rows: { u1: { coach_insights: { recomputedOn: "2026-06-05", lastWorkoutDateAtGeneration: "2026-06-01" } } },
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
      rows: { u1: { race_prediction: { recomputedOn: null, lastWorkoutDateAtGeneration: "2026-06-01" } } },
    });

    const result = await runAnalyticsRecomputeScan(storage, NOW);

    expect(result.enqueued).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][1]).toEqual({ userId: "u1", feature: "race_prediction", localDate: "2026-06-05" });
  });

  it("skips users with no logged workouts", async () => {
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
});
