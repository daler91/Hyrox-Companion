import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * D10 (CODEBASE_ANALYSIS_2026-10-03): a Strava sync writes logs (imports) and
 * changes them (links), so the athlete's cached analytics slices have to go
 * once it has — the Sync button's refetch otherwise answers from the cache.
 * Kept out of strava.test.ts, which is already past the file-size budget.
 */

vi.mock("./utils/httpRetry");

const mocks = vi.hoisted(() => ({
  reconcileStravaActivities: vi.fn(),
  invalidateAnalyticsCachesForUser: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("./env", () => ({
  env: {
    STRAVA_CLIENT_ID: "client-id",
    STRAVA_CLIENT_SECRET: "client-secret",
    STRAVA_STATE_SECRET: "dedicated-strava-secret-12345678", // gitleaks:allow — fake test-only value, not a credential
    DATABASE_URL: "postgres://dummy",
    APP_URL: "https://app.example.com",
  },
}));
vi.mock("./storage", () => ({
  storage: {
    users: {
      getStravaConnection: vi.fn().mockResolvedValue({
        userId: "user-1",
        accessToken: "stored-access",
        refreshToken: "stored-refresh",
        expiresAt: new Date(Date.now() + 3_600_000),
        lastSyncedAt: null,
        requiresReauth: false,
      }),
      getUser: vi.fn().mockResolvedValue({ id: "user-1", distanceUnit: "km" }),
      updateStravaLastSync: vi.fn(() => Promise.resolve()),
    },
    workouts: {
      getExistingStravaActivityIds: vi.fn().mockResolvedValue([]),
      listDeviceRecordingsForDates: vi.fn().mockResolvedValue([]),
    },
  },
}));
vi.mock("./services/stravaReconciler", () => ({
  reconcileStravaActivities: mocks.reconcileStravaActivities,
}));
vi.mock("./services/analyticsRouteCache", () => ({
  invalidateAnalyticsCachesForUser: mocks.invalidateAnalyticsCachesForUser,
}));
vi.mock("./services/sessionStreamQueue", () => ({
  enqueueSessionStreams: vi.fn().mockResolvedValue({}),
}));
vi.mock("./services/stravaSyncQueue", () => ({
  enqueueStravaSync: vi.fn(),
  getStravaAutoSyncIntervalMs: () => 3_600_000,
  isStravaAutoSyncEnabled: () => true,
}));
vi.mock("./stravaWebhook", () => ({ getStravaWebhookState: vi.fn().mockResolvedValue(null) }));

import { syncStravaForUser } from "./strava";

const NO_WRITES = { enriched: 0, completedPlanDays: 0, suggested: 0, standalone: 0, skipped: 0 };
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function stravaResponse(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body), headers: { get: () => null } };
}

const RUN = {
  id: 5,
  name: "Run 5",
  type: "Run",
  sport_type: "Run",
  start_date: "2026-10-01T07:00:00Z",
  start_date_local: "2026-10-01T08:00:00Z",
  distance: 5000,
  moving_time: 1500,
  elapsed_time: 1600,
  total_elevation_gain: 20,
  average_speed: 3.3,
  max_speed: 4.1,
};

describe("syncStravaForUser and the analytics caches (D10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.fetch
      .mockResolvedValueOnce(stravaResponse([RUN]))
      .mockResolvedValueOnce(stravaResponse({ id: 5 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["an import", { ...NO_WRITES, standalone: 1 }],
    ["a plan day the recording completed", { ...NO_WRITES, completedPlanDays: 1 }],
    ["a log the recording enriched", { ...NO_WRITES, enriched: 1 }],
  ])("drops the athlete's cached slices after %s", async (_label, counts) => {
    mocks.reconcileStravaActivities.mockResolvedValue(counts);

    await expect(syncStravaForUser("user-1", log)).resolves.toMatchObject({
      ok: true,
      imported: 1,
    });

    expect(mocks.invalidateAnalyticsCachesForUser).toHaveBeenCalledWith("user-1");
  });

  it("leaves them alone when the sync wrote nothing", async () => {
    mocks.reconcileStravaActivities.mockResolvedValue({ ...NO_WRITES, skipped: 1 });

    await expect(syncStravaForUser("user-1", log)).resolves.toMatchObject({
      ok: true,
      imported: 0,
    });

    expect(mocks.invalidateAnalyticsCachesForUser).not.toHaveBeenCalled();
  });
});
