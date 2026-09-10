import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const env: {
    STRAVA_AUTO_SYNC_ENABLED: string;
    STRAVA_AUTO_SYNC_INTERVAL_MINUTES: number | undefined;
  } = {
    STRAVA_AUTO_SYNC_ENABLED: "true",
    STRAVA_AUTO_SYNC_INTERVAL_MINUTES: 45,
  };
  return { sendDebounced: vi.fn(), env };
});

vi.mock("../../queue", () => ({
  queue: { sendDebounced: mocks.sendDebounced },
  DEFAULT_JOB_OPTIONS: { retryLimit: 3, retryBackoff: true, expireInMinutes: 60 },
  // Stand-in for the request-id stamping; the real one is covered by queue tests.
  withTrace: (data: Record<string, unknown>) => ({ ...data, __requestId: "req-1" }),
}));
vi.mock("../../env", () => ({ env: mocks.env }));

import {
  enqueueStravaSync,
  getStravaAutoSyncIntervalMs,
  isStravaAutoSyncEnabled,
  STRAVA_SYNC_DEBOUNCE_SECONDS,
  STRAVA_SYNC_QUEUE,
} from "../stravaSyncQueue";

describe("enqueueStravaSync", () => {
  beforeEach(() => {
    mocks.sendDebounced.mockReset();
    mocks.env.STRAVA_AUTO_SYNC_ENABLED = "true";
    mocks.env.STRAVA_AUTO_SYNC_INTERVAL_MINUTES = 45;
  });

  it("debounces per athlete with the default retry policy and a traced payload", async () => {
    mocks.sendDebounced.mockResolvedValue("job-1");

    const result = await enqueueStravaSync("user-1", "webhook");

    expect(result).toEqual({ enqueued: true, jobId: "job-1" });
    expect(mocks.sendDebounced).toHaveBeenCalledWith(
      STRAVA_SYNC_QUEUE,
      { userId: "user-1", trigger: "webhook", __requestId: "req-1" },
      { retryLimit: 3, retryBackoff: true, expireInMinutes: 60 },
      STRAVA_SYNC_DEBOUNCE_SECONDS,
      "strava-sync:user-1",
    );
  });

  it("reports a coalesced request when pg-boss folds it into a pending job", async () => {
    mocks.sendDebounced.mockResolvedValue(null);

    await expect(enqueueStravaSync("user-1", "poll")).resolves.toEqual({
      enqueued: false,
      jobId: null,
    });
  });

  it("does nothing under the kill switch", async () => {
    mocks.env.STRAVA_AUTO_SYNC_ENABLED = "false";

    await expect(enqueueStravaSync("user-1", "connect")).resolves.toEqual({
      enqueued: false,
      jobId: null,
    });
    expect(mocks.sendDebounced).not.toHaveBeenCalled();
    expect(isStravaAutoSyncEnabled()).toBe(false);
  });
});

describe("getStravaAutoSyncIntervalMs", () => {
  it("converts the configured minutes to milliseconds", () => {
    mocks.env.STRAVA_AUTO_SYNC_INTERVAL_MINUTES = 45;
    expect(getStravaAutoSyncIntervalMs()).toBe(45 * 60_000);
  });

  it("falls back to an hour when the setting is absent", () => {
    mocks.env.STRAVA_AUTO_SYNC_INTERVAL_MINUTES = undefined;
    expect(getStravaAutoSyncIntervalMs()).toBe(60 * 60_000);
  });
});
