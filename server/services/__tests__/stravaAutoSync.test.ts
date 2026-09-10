import type { Job } from "pg-boss";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IStorage } from "../../storage";

const mocks = vi.hoisted(() => ({
  syncStravaForUser: vi.fn(),
  getRuntimeCache: vi.fn(),
  setRuntimeCache: vi.fn(),
  enqueueStravaSync: vi.fn(),
  isStravaAutoSyncEnabled: vi.fn(() => true),
  createQueue: vi.fn(),
  work: vi.fn(),
}));

vi.mock("../../strava", () => ({ syncStravaForUser: mocks.syncStravaForUser }));
vi.mock("../../sharedRuntimeState", () => ({
  getRuntimeCache: mocks.getRuntimeCache,
  setRuntimeCache: mocks.setRuntimeCache,
}));
vi.mock("../stravaSyncQueue", () => ({
  enqueueStravaSync: mocks.enqueueStravaSync,
  getStravaAutoSyncIntervalMs: () => 60 * 60_000,
  isStravaAutoSyncEnabled: mocks.isStravaAutoSyncEnabled,
  STRAVA_SYNC_QUEUE: "strava-sync",
}));
vi.mock("../../queue", () => ({
  queue: { createQueue: mocks.createQueue, work: mocks.work },
  jobDataKeys: (job: { data?: object }) => Object.keys(job.data ?? {}),
  // Sequential stand-ins for the real batch/timeout wrappers.
  runBatch: async (_name: string, jobs: unknown[], fn: (job: unknown) => Promise<unknown>) => {
    for (const job of jobs) await fn(job);
  },
  runWithTimeout: (_label: string, fn: (signal: AbortSignal) => Promise<unknown>) =>
    fn(new AbortController().signal),
}));
vi.mock("../../logger", () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() };
  logger.child.mockReturnValue(logger);
  return { logger };
});

import {
  getStravaSyncCooldownUntil,
  registerStravaAutoSyncWorker,
  runStravaAutoSyncScan,
  runStravaSyncJob,
  STRAVA_AUTO_SYNC_MAX_USERS_PER_TICK,
  STRAVA_SYNC_MIN_COOLDOWN_MS,
} from "../stravaAutoSync";

const FIXED_NOW = 1_700_000_000_000;
const COOLDOWN_KEY = "strava:sync-cooldown";

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const okOutcome = {
  ok: true as const,
  imported: 2,
  enriched: 1,
  completedPlanDays: 0,
  suggested: 1,
  standalone: 0,
  skipped: 3,
  total: 5,
  hasMore: false,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXED_NOW));
  mocks.syncStravaForUser.mockReset();
  mocks.getRuntimeCache.mockReset().mockResolvedValue(undefined);
  mocks.setRuntimeCache.mockReset().mockResolvedValue(undefined);
  mocks.enqueueStravaSync.mockReset();
  mocks.isStravaAutoSyncEnabled.mockReset().mockReturnValue(true);
  mocks.createQueue.mockReset().mockResolvedValue(undefined);
  mocks.work.mockReset().mockResolvedValue(undefined);
  log.info.mockClear();
  log.warn.mockClear();
  log.error.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runStravaSyncJob", () => {
  it("runs the shared sync engine and reports the import counts", async () => {
    mocks.syncStravaForUser.mockResolvedValue(okOutcome);

    const result = await runStravaSyncJob({ userId: "user-1", trigger: "webhook" }, log);

    expect(mocks.syncStravaForUser).toHaveBeenCalledWith("user-1", log);
    const { ok: _ok, ...counts } = okOutcome;
    expect(result).toEqual({ status: "synced", trigger: "webhook", counts });
    expect(mocks.setRuntimeCache).not.toHaveBeenCalled();
  });

  it("pauses every background sync for at least a 15-minute window after a 429", async () => {
    mocks.syncStravaForUser.mockResolvedValue({
      ok: false,
      reason: "rate_limited",
      retryAfterSeconds: 30,
    });

    const result = await runStravaSyncJob({ userId: "user-1", trigger: "poll" }, log);

    const until = FIXED_NOW + STRAVA_SYNC_MIN_COOLDOWN_MS;
    expect(result).toEqual({ status: "rate_limited", cooldownUntil: until });
    expect(mocks.setRuntimeCache).toHaveBeenCalledWith(
      COOLDOWN_KEY,
      { until },
      STRAVA_SYNC_MIN_COOLDOWN_MS,
    );
    expect(log.warn).toHaveBeenCalled();
  });

  it("honours a longer Retry-After than the minimum window", async () => {
    mocks.syncStravaForUser.mockResolvedValue({
      ok: false,
      reason: "rate_limited",
      retryAfterSeconds: 3600,
    });

    const result = await runStravaSyncJob({ userId: "user-1", trigger: "poll" }, log);

    expect(result).toEqual({ status: "rate_limited", cooldownUntil: FIXED_NOW + 3_600_000 });
  });

  it("skips the sync while a cooldown is in force", async () => {
    mocks.getRuntimeCache.mockResolvedValue({ until: FIXED_NOW + 60_000 });

    const result = await runStravaSyncJob({ userId: "user-1", trigger: "webhook" }, log);

    expect(result).toEqual({ status: "cooldown" });
    expect(mocks.syncStravaForUser).not.toHaveBeenCalled();
  });

  it("ignores an expired cooldown row", async () => {
    mocks.getRuntimeCache.mockResolvedValue({ until: FIXED_NOW - 1 });
    mocks.syncStravaForUser.mockResolvedValue(okOutcome);

    const result = await runStravaSyncJob({ userId: "user-1", trigger: "poll" }, log);

    expect(result.status).toBe("synced");
    await expect(getStravaSyncCooldownUntil()).resolves.toBeNull();
  });

  it("treats a shared-cache read failure as no cooldown", async () => {
    mocks.getRuntimeCache.mockRejectedValue(new Error("cache down"));
    mocks.syncStravaForUser.mockResolvedValue(okOutcome);

    const result = await runStravaSyncJob({ userId: "user-1", trigger: "poll" }, log);

    expect(result.status).toBe("synced");
  });

  it.each(["reauth_required", "not_connected", "transient"] as const)(
    "absorbs a %s outcome without throwing so the next scan retries",
    async (reason) => {
      mocks.syncStravaForUser.mockResolvedValue({ ok: false, reason });

      const result = await runStravaSyncJob({ userId: "user-1", trigger: "poll" }, log);

      expect(result).toEqual({ status: reason });
      expect(mocks.setRuntimeCache).not.toHaveBeenCalled();
    },
  );

  it("does nothing under the kill switch", async () => {
    mocks.isStravaAutoSyncEnabled.mockReturnValue(false);

    const result = await runStravaSyncJob({ userId: "user-1", trigger: "connect" }, log);

    expect(result).toEqual({ status: "disabled" });
    expect(mocks.syncStravaForUser).not.toHaveBeenCalled();
  });

  it("lets an unexpected failure propagate so pg-boss can retry it", async () => {
    mocks.syncStravaForUser.mockRejectedValue(new Error("db down"));

    await expect(runStravaSyncJob({ userId: "user-1", trigger: "poll" }, log)).rejects.toThrow(
      "db down",
    );
  });
});

describe("runStravaAutoSyncScan", () => {
  function makeStorage(due: Array<{ userId: string; lastSyncedAt: Date | null }>): IStorage {
    return {
      users: { listStravaConnectionsDueForSync: vi.fn().mockResolvedValue(due) },
    } as unknown as IStorage;
  }

  it("enqueues a poll-triggered sync for each due connection, stalest first and capped", async () => {
    const storage = makeStorage([
      { userId: "u-never", lastSyncedAt: null },
      { userId: "u-stale", lastSyncedAt: new Date(FIXED_NOW - 3 * 3_600_000) },
    ]);
    mocks.enqueueStravaSync
      .mockResolvedValueOnce({ enqueued: true, jobId: "j1" })
      // Already coalesced into a pending webhook job — counts as checked, not enqueued.
      .mockResolvedValueOnce({ enqueued: false, jobId: null });

    const result = await runStravaAutoSyncScan(storage, new Date(FIXED_NOW));

    expect(storage.users.listStravaConnectionsDueForSync).toHaveBeenCalledWith(
      new Date(FIXED_NOW - 60 * 60_000),
      STRAVA_AUTO_SYNC_MAX_USERS_PER_TICK,
    );
    expect(mocks.enqueueStravaSync.mock.calls).toEqual([
      ["u-never", "poll"],
      ["u-stale", "poll"],
    ]);
    expect(result).toEqual({ usersChecked: 2, enqueued: 1, skipped: null });
  });

  it("skips the tick entirely while a rate-limit cooldown is in force", async () => {
    mocks.getRuntimeCache.mockResolvedValue({ until: FIXED_NOW + 5 * 60_000 });
    const storage = makeStorage([{ userId: "u-1", lastSyncedAt: null }]);

    const result = await runStravaAutoSyncScan(storage, new Date(FIXED_NOW));

    expect(result).toEqual({ usersChecked: 0, enqueued: 0, skipped: "cooldown" });
    expect(storage.users.listStravaConnectionsDueForSync).not.toHaveBeenCalled();
  });

  it("does nothing under the kill switch", async () => {
    mocks.isStravaAutoSyncEnabled.mockReturnValue(false);
    const storage = makeStorage([{ userId: "u-1", lastSyncedAt: null }]);

    const result = await runStravaAutoSyncScan(storage, new Date(FIXED_NOW));

    expect(result).toEqual({ usersChecked: 0, enqueued: 0, skipped: "disabled" });
    expect(storage.users.listStravaConnectionsDueForSync).not.toHaveBeenCalled();
  });
});

describe("registerStravaAutoSyncWorker", () => {
  async function registerAndCaptureHandler() {
    await registerStravaAutoSyncWorker();
    expect(mocks.createQueue).toHaveBeenCalledWith("strava-sync");
    expect(mocks.work).toHaveBeenCalledWith("strava-sync", expect.any(Function));
    return mocks.work.mock.calls[0][1] as (jobs: Job[]) => Promise<void>;
  }

  it("syncs the athlete named on the job", async () => {
    mocks.syncStravaForUser.mockResolvedValue(okOutcome);
    const handler = await registerAndCaptureHandler();

    await handler([{ id: "job-1", data: { userId: "user-1", trigger: "webhook" } } as Job]);

    expect(mocks.syncStravaForUser).toHaveBeenCalledWith("user-1", expect.anything());
  });

  it("skips a job with no userId instead of failing the batch", async () => {
    const handler = await registerAndCaptureHandler();

    await expect(
      handler([{ id: "job-2", data: { trigger: "poll" } } as Job]),
    ).resolves.toBeUndefined();

    expect(mocks.syncStravaForUser).not.toHaveBeenCalled();
  });

  it("rethrows an unexpected failure so pg-boss retries the job", async () => {
    mocks.syncStravaForUser.mockRejectedValue(new Error("db down"));
    const handler = await registerAndCaptureHandler();

    await expect(
      handler([{ id: "job-3", data: { userId: "user-1", trigger: "poll" } } as Job]),
    ).rejects.toThrow("db down");
  });
});
