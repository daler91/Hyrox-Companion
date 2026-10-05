import type { GarminConnect as GarminConnectType } from "@flow-js/garmin-connect";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __testing, registerGarminRoutes } from "./garmin";
import { logger } from "./logger";
import { createTestApp } from "./routes/__tests__/testUtils";
import { clearRateLimitBuckets } from "./routeUtils";
import { invalidateAnalyticsCachesForUser } from "./services/analyticsRouteCache";
import { storage } from "./storage";

/**
 * Orchestration tests for the Garmin sync flow — the seven-safety-layer side
 * of garmin.ts that garmin.test.ts (primitives) and garminMapper.test.ts
 * (pure mapping) don't reach. The SDK is injected through the
 * __testing.setGarminConnectCtor seam because the real module is loaded via
 * createRequire at module scope, out of vi.mock's reach.
 */

// Standalone handles on the connection writes the token tests assert on.
const connectionMocks = vi.hoisted(() => ({
  getGarminConnection: vi.fn(),
  setGarminError: vi.fn(() => Promise.resolve()),
  updateGarminTokens: vi.fn(() => Promise.resolve()),
  updateGarminLastSync: vi.fn(() => Promise.resolve()),
  getExistingGarminActivityIds: vi.fn(),
}));

// The import's insert-plus-sets transaction (C26) runs on a sentinel handle;
// the rest of ./db (the pool the rate limiter store uses) stays real.
const txMocks = vi.hoisted(() => {
  const handle = { garminImportTx: true };
  return {
    handle,
    transaction: vi.fn((work: (tx: unknown) => Promise<unknown>) => work(handle)),
  };
});
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  db: { transaction: txMocks.transaction },
}));

vi.mock("./storage", () => ({
  storage: {
    users: {
      getGarminConnection: connectionMocks.getGarminConnection,
      setGarminError: connectionMocks.setGarminError,
      updateGarminTokens: connectionMocks.updateGarminTokens,
      updateGarminLastSync: connectionMocks.updateGarminLastSync,
      upsertGarminConnection: vi.fn().mockResolvedValue(undefined),
      deleteGarminConnection: vi.fn().mockResolvedValue(undefined),
      getUser: vi.fn(),
    },
    workouts: {
      getExistingGarminActivityIds: connectionMocks.getExistingGarminActivityIds,
      listDeviceRecordingsForDates: vi.fn(),
      createGarminWorkoutLogs: vi.fn(),
      createDeviceActivitySets: vi.fn(),
    },
  },
}));
vi.mock("./clerkAuth", () => ({
  isAuthenticated: (req: express.Request, _res: express.Response, next: () => void) => {
    (req as { auth?: unknown }).auth = { userId: "user-1" };
    next();
  },
}));
vi.mock("./types", () => ({ getUserId: () => "user-1" }));
vi.mock("./middleware/idempotency", () => ({
  idempotencyMiddleware: (_req: express.Request, _res: express.Response, next: () => void) => {
    next();
    return Promise.resolve();
  },
}));
vi.mock("./services/analyticsRouteCache", () => ({ invalidateAnalyticsCachesForUser: vi.fn() }));
vi.mock("./sharedRuntimeState", () => ({
  getRuntimeCache: vi.fn().mockResolvedValue(null),
  setRuntimeCache: vi.fn().mockResolvedValue(undefined),
  claimRuntimeCacheKey: vi.fn().mockResolvedValue(true),
  deleteRuntimeCache: vi.fn().mockResolvedValue(undefined),
}));

const noop = (): void => undefined;

// Fake SDK injected through the constructor seam.
class FakeGarminConnect {
  static instances: FakeGarminConnect[] = [];
  static loginImpl: () => Promise<unknown> = () => Promise.resolve(undefined);
  static getActivitiesImpl: (start: number, limit: number) => Promise<unknown> = () => Promise.resolve([]);
  static refreshImpl: () => Promise<void> = () => Promise.resolve();
  static onConstruct: () => void = noop;
  static reset(): void {
    this.instances = [];
    this.loginImpl = () => Promise.resolve(undefined);
    this.getActivitiesImpl = () => Promise.resolve([]);
    this.refreshImpl = () => Promise.resolve();
    this.onConstruct = noop;
  }

  // The SDK's HttpClient: re-mints OAuth2 from the loaded OAuth1 token.
  client = { refreshOauth2Token: vi.fn(() => FakeGarminConnect.refreshImpl()) };

  login = vi.fn((_email?: string, _password?: string) => FakeGarminConnect.loginImpl());
  loadToken = vi.fn();
  getActivities = vi.fn((start: number, limit: number) => FakeGarminConnect.getActivitiesImpl(start, limit));
  getUserProfile = vi.fn(() => Promise.resolve({ displayName: "Test Athlete" }));
  exportToken = vi.fn(() => ({
    oauth1: { oauth_token: "o1" },
    oauth2: { access_token: "o2", expires_at: Math.floor(Date.now() / 1000) + 3600 },
  }));

  constructor(public opts: { username: string; password: string }) {
    FakeGarminConnect.instances.push(this);
    FakeGarminConnect.onConstruct();
  }
}

// The stored-connection fixture's login, shared by the tests that log in with it.
const FIXTURE_EMAIL = "a@example.com";
const FIXTURE_PW = "pw";

function conn(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user-1",
    garminDisplayName: "Test Athlete",
    // Storage decrypts in place — plaintext despite the column names.
    encryptedEmail: FIXTURE_EMAIL,
    encryptedPassword: FIXTURE_PW,
    encryptedOauth1Token: JSON.stringify({ oauth_token: "o1" }),
    encryptedOauth2Token: JSON.stringify({ access_token: "o2" }),
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000), // fresh (> 5-min buffer)
    lastSyncedAt: null,
    lastError: null,
    ...overrides,
  } as never;
}

/** A connection with no cached tokens, so only a login can produce a client. */
const NO_CACHED_TOKENS = { encryptedOauth1Token: null, encryptedOauth2Token: null, tokenExpiresAt: null };

function activity(id: number) {
  return {
    activityId: id,
    activityName: `Run ${id}`,
    startTimeLocal: "2026-07-01 08:00:00",
    activityType: { typeKey: "running" },
    distance: 5000,
    duration: 1500,
    averageHR: 150,
  };
}

function mockRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res as never;
}

let app: express.Express;

beforeEach(() => {
  vi.clearAllMocks();
  clearRateLimitBuckets();
  FakeGarminConnect.reset();
  __testing.setGarminConnectCtor(FakeGarminConnect as unknown as typeof GarminConnectType);
  __testing.garminCircuitBreaker._resetForTests();
  __testing.inFlightUsers.clear();
  const router = express.Router();
  registerGarminRoutes(router);
  app = createTestApp(router);
  vi.mocked(storage.users.getUser).mockResolvedValue({ distanceUnit: "km" } as never);
  vi.mocked(storage.workouts.getExistingGarminActivityIds).mockResolvedValue([]);
  vi.mocked(storage.workouts.listDeviceRecordingsForDates).mockResolvedValue([]);
  vi.mocked(storage.workouts.createGarminWorkoutLogs).mockImplementation(
    async (rows: unknown) => rows as never,
  );
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  __testing.resetGarminConnectCtor();
});

describe("POST /sync import accounting", () => {
  it("holds the imported + skipped == total invariant, including the insert-time backstop", async () => {
    vi.mocked(storage.users.getGarminConnection).mockResolvedValue(conn());
    FakeGarminConnect.getActivitiesImpl = () =>
      Promise.resolve([activity(1), activity(2), activity(3), activity(4)]);
    // Activity 1 already known (pre-dedup); of the 3 attempted, the DB's
    // onConflictDoNothing backstop swallows one more.
    vi.mocked(storage.workouts.getExistingGarminActivityIds).mockResolvedValue(["1"]);
    vi.mocked(storage.workouts.createGarminWorkoutLogs).mockImplementation(
      async (rows: unknown) => (rows as unknown[]).slice(0, 2) as never,
    );

    const res = await request(app).post("/api/v1/garmin/sync");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, imported: 2, skipped: 2, total: 4 });
    expect(res.body.imported + res.body.skipped).toBe(res.body.total);
    expect(vi.mocked(storage.workouts.createGarminWorkoutLogs).mock.calls[0][0]).toHaveLength(3);
    expect(storage.users.updateGarminLastSync).toHaveBeenCalledWith("user-1");
    // D10 (CODEBASE_ANALYSIS_2026-10-03): new logs drop the cached analytics.
    expect(invalidateAnalyticsCachesForUser).toHaveBeenCalledWith("user-1");
  });

  it("leaves the cached analytics alone when the sync imported nothing", async () => {
    connectionMocks.getGarminConnection.mockResolvedValue(conn());
    FakeGarminConnect.getActivitiesImpl = () => Promise.resolve([activity(1)]);
    connectionMocks.getExistingGarminActivityIds.mockResolvedValue(["1"]);

    const res = await request(app).post("/api/v1/garmin/sync");

    expect(res.body).toMatchObject({ success: true, imported: 0, skipped: 1 });
    expect(invalidateAnalyticsCachesForUser).not.toHaveBeenCalled();
  });

  it("skips a session the Strava sync already imported and counts it as skipped", async () => {
    // D16 (CODEBASE_ANALYSIS_2026-10-03): the watch auto-uploads to Strava, so
    // with both connected the same run arrives from both syncs.
    connectionMocks.getGarminConnection.mockResolvedValue(conn());
    FakeGarminConnect.getActivitiesImpl = () =>
      Promise.resolve([
        { ...activity(1), startTimeGMT: "2026-07-01 07:00:00" },
        { ...activity(2), startTimeLocal: "2026-07-01 18:00:00", startTimeGMT: "2026-07-01 17:00:00" },
      ]);
    vi.mocked(storage.workouts.listDeviceRecordingsForDates).mockResolvedValue([
      {
        startedAt: new Date("2026-07-01T07:00:05Z"),
        duration: 25,
        focus: "Run",
        deviceActivity: null,
      },
    ]);

    const res = await request(app).post("/api/v1/garmin/sync");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, imported: 1, skipped: 1, total: 2 });
    expect(storage.workouts.listDeviceRecordingsForDates).toHaveBeenCalledWith(
      "user-1",
      ["2026-07-01"],
      "strava",
    );
    const inserted = vi.mocked(storage.workouts.createGarminWorkoutLogs).mock.calls[0][0];
    expect(inserted.map((row) => row.garminActivityId)).toEqual(["2"]);
  });

  // D34 (CODEBASE_ANALYSIS_2026-10-03): only a genuine auth rejection records
  // lastError, which also wipes the stored credentials.
  it("translates a non-array activities response into 502 GARMIN_API_ERROR and keeps the connection", async () => {
    connectionMocks.getGarminConnection.mockResolvedValue(conn());
    FakeGarminConnect.getActivitiesImpl = () => Promise.resolve({ error: "maintenance" });

    const res = await request(app).post("/api/v1/garmin/sync");

    expect(res.status).toBe(502);
    expect(res.body.code).toBe("GARMIN_API_ERROR");
    expect(res.body.error).not.toMatch(/login failed/i);
    expect(storage.users.setGarminError).not.toHaveBeenCalled();
    expect(storage.users.updateGarminLastSync).not.toHaveBeenCalled();
  });

  it("records the error when Garmin rejects the activity fetch with a 401", async () => {
    connectionMocks.getGarminConnection.mockResolvedValue(conn());
    FakeGarminConnect.getActivitiesImpl = () =>
      Promise.reject(Object.assign(new Error("Request failed"), { response: { status: 401 } }));

    const res = await request(app).post("/api/v1/garmin/sync");

    expect(res.status).toBe(502);
    expect(res.body.code).toBe("GARMIN_API_ERROR");
    expect(storage.users.setGarminError).toHaveBeenCalledWith(
      "user-1",
      expect.stringMatching(/rejected the credentials/i),
    );
  });

  it("answers a DB failure during import with a 500 and keeps the Garmin connection", async () => {
    connectionMocks.getGarminConnection.mockResolvedValue(conn());
    FakeGarminConnect.getActivitiesImpl = () => Promise.resolve([activity(1)]);
    connectionMocks.getExistingGarminActivityIds.mockRejectedValue(
      new Error("canceling statement due to statement timeout"),
    );

    const res = await request(app).post("/api/v1/garmin/sync");

    expect(res.status).toBe(500);
    expect(storage.users.setGarminError).not.toHaveBeenCalled();
    expect(storage.users.updateGarminLastSync).not.toHaveBeenCalled();
  });
});

// C26 (CODEBASE_ANALYSIS_2026-10-03): the sync read one page of 20 and wrote no
// exercise set, so activities past the newest 20 never arrived and a
// Garmin-only athlete's runs never reached the set-derived Analytics panels.
describe("POST /sync paging and synthesised sets", () => {
  const PAGE = __testing.GARMIN_ACTIVITIES_PER_SYNC;
  const HOUR_MS = 60 * 60 * 1000;

  /** A run that started `hoursAgo` hours before now, as Garmin lists it. */
  function recentRun(id: number, hoursAgo: number) {
    const start = new Date(Date.now() - hoursAgo * HOUR_MS).toISOString().replace("T", " ").slice(0, 19);
    return { ...activity(id), startTimeLocal: start, startTimeGMT: start };
  }

  /** A history of `total` runs, newest first, one every `spacingHours`, served a page at a time. */
  function history(total: number, spacingHours: number) {
    return (start: number, limit: number) =>
      Promise.resolve(
        Array.from({ length: Math.max(0, Math.min(limit, total - start)) }, (_value, offset) =>
          recentRun(start + offset + 1, (start + offset + 1) * spacingHours),
        ),
      );
  }

  function pageStarts(): number[] {
    return FakeGarminConnect.instances[0].getActivities.mock.calls.map(([start]) => start);
  }

  beforeEach(() => {
    connectionMocks.getGarminConnection.mockResolvedValue(conn());
  });

  it("pages back past the newest 20 until Garmin runs out", async () => {
    FakeGarminConnect.getActivitiesImpl = history(25, 6);

    const res = await request(app).post("/api/v1/garmin/sync");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, imported: 25, skipped: 0, total: 25 });
    expect(pageStarts()).toEqual([0, PAGE]);
    expect(vi.mocked(storage.workouts.createGarminWorkoutLogs).mock.calls[0][0]).toHaveLength(25);
  });

  it("stops at the last sync less a week", async () => {
    connectionMocks.getGarminConnection.mockResolvedValue(
      conn({ lastSyncedAt: new Date(Date.now() - 2 * 24 * HOUR_MS) }),
    );
    // Twelve hours apart, the first page already reaches ten days back.
    FakeGarminConnect.getActivitiesImpl = history(500, 12);

    const res = await request(app).post("/api/v1/garmin/sync");

    expect(res.body).toMatchObject({ success: true, total: PAGE });
    expect(pageStarts()).toEqual([0]);
  });

  it("never reads more than the page cap in one sync", async () => {
    FakeGarminConnect.getActivitiesImpl = history(1000, 1);

    const res = await request(app).post("/api/v1/garmin/sync");

    expect(res.body).toMatchObject({ success: true, total: PAGE * __testing.GARMIN_MAX_SYNC_PAGES });
    expect(pageStarts()).toHaveLength(__testing.GARMIN_MAX_SYNC_PAGES);
  });

  it("counts an activity that slid onto the next page once", async () => {
    // A new upload between the two reads pushes run 20 onto page two as well.
    FakeGarminConnect.getActivitiesImpl = (start) =>
      Promise.resolve(
        start === 0
          ? Array.from({ length: PAGE }, (_value, offset) => recentRun(offset + 1, offset + 1))
          : [recentRun(PAGE, PAGE), recentRun(PAGE + 1, PAGE + 1)],
      );

    const res = await request(app).post("/api/v1/garmin/sync");

    expect(res.body).toMatchObject({ success: true, imported: PAGE + 1, total: PAGE + 1 });
  });

  it("fails the whole sync when a later page fails, importing nothing", async () => {
    const firstPage = history(PAGE, 1);
    FakeGarminConnect.getActivitiesImpl = (start, limit) =>
      start === 0
        ? firstPage(start, limit)
        : Promise.reject(Object.assign(new Error("Request failed"), { response: { status: 500 } }));

    const res = await request(app).post("/api/v1/garmin/sync");

    expect(res.status).toBe(502);
    expect(storage.workouts.createGarminWorkoutLogs).not.toHaveBeenCalled();
    expect(storage.users.updateGarminLastSync).not.toHaveBeenCalled();
    expect(storage.users.setGarminError).not.toHaveBeenCalled();
  });

  it("writes each run's set with its log, in one transaction, timed in seconds", async () => {
    FakeGarminConnect.getActivitiesImpl = () =>
      Promise.resolve([
        { ...recentRun(1, 2), movingDuration: 1501 },
        { ...recentRun(2, 30), activityType: { typeKey: "strength_training" } },
      ]);

    const res = await request(app).post("/api/v1/garmin/sync");

    expect(res.body).toMatchObject({ success: true, imported: 2 });
    expect(txMocks.transaction).toHaveBeenCalledTimes(1);
    expect(vi.mocked(storage.workouts.createGarminWorkoutLogs).mock.calls[0][1]).toBe(txMocks.handle);
    const [sets, tx] = vi.mocked(storage.workouts.createDeviceActivitySets).mock.calls[0];
    expect(tx).toBe(txMocks.handle);
    // The strength session says nothing a set could hold, so it gets none.
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ exerciseName: "run", category: "running", distance: 5000, reps: null });
    // 1501 s, not the row's rounded 25 minutes.
    expect(sets[0].time).toBeCloseTo(1501 / 60, 6);
  });

  it("writes no set for a row the insert-time backstop swallowed", async () => {
    FakeGarminConnect.getActivitiesImpl = () => Promise.resolve([recentRun(1, 2), recentRun(2, 3)]);
    vi.mocked(storage.workouts.createGarminWorkoutLogs).mockImplementation((rows: unknown) =>
      Promise.resolve((rows as unknown[]).slice(0, 1) as never),
    );

    await request(app).post("/api/v1/garmin/sync");

    const [sets] = vi.mocked(storage.workouts.createDeviceActivitySets).mock.calls[0];
    expect(sets).toHaveLength(1);
  });
});

describe("getGarminClient token strategy", () => {
  it("uses cached tokens without logging in when they are fresh", async () => {
    vi.mocked(storage.users.getGarminConnection).mockResolvedValue(conn());

    const res = await request(app).post("/api/v1/garmin/sync");

    expect(res.status).toBe(200);
    const client = FakeGarminConnect.instances[0];
    expect(client.loadToken).toHaveBeenCalledTimes(1);
    expect(client.login).not.toHaveBeenCalled();
    expect(storage.users.updateGarminTokens).not.toHaveBeenCalled();
  });

  it("falls through corrupted token JSON to a fresh login and persists new tokens", async () => {
    vi.mocked(storage.users.getGarminConnection).mockResolvedValue(
      conn({ encryptedOauth1Token: "{not-json" }),
    );

    const res = await request(app).post("/api/v1/garmin/sync");

    expect(res.status).toBe(200);
    const client = FakeGarminConnect.instances[0];
    expect(client.loadToken).not.toHaveBeenCalled();
    expect(client.login).toHaveBeenCalledWith(FIXTURE_EMAIL, FIXTURE_PW);
    expect(storage.users.updateGarminTokens).toHaveBeenCalledWith(
      "user-1",
      JSON.stringify({ oauth_token: "o1" }),
      expect.stringContaining('"access_token":"o2"'),
      expect.any(Date),
    );
  });

  // D6 (CODEBASE_ANALYSIS_2026-10-03): the OAuth2 token lapses within hours,
  // the OAuth1 one lasts about a year. An expired OAuth2 used to mean a full
  // email/password SSO login from the shared server IP on most syncs.
  const EXPIRED = { tokenExpiresAt: new Date(Date.now() - 1000) };

  it("re-mints an expired OAuth2 token from the cached OAuth1 one without an SSO login", async () => {
    connectionMocks.getGarminConnection.mockResolvedValue(conn(EXPIRED));

    const res = await request(app).post("/api/v1/garmin/sync");

    expect(res.status).toBe(200);
    const client = FakeGarminConnect.instances[0];
    expect(client.loadToken).toHaveBeenCalledWith({ oauth_token: "o1" }, { access_token: "o2" });
    expect(client.client.refreshOauth2Token).toHaveBeenCalledTimes(1);
    expect(client.login).not.toHaveBeenCalled();
    expect(connectionMocks.updateGarminTokens).toHaveBeenCalledWith(
      "user-1",
      JSON.stringify({ oauth_token: "o1" }),
      expect.stringContaining('"access_token":"o2"'),
      expect.any(Date),
    );
  });

  it.each([
    // The SDK swallows the exchange's 401 and then throws reading the missing token.
    ["the SDK's swallowed 401", () => new TypeError("Cannot set properties of undefined (setting 'last_update_date')")],
    ["a 403", () => Object.assign(new Error("Request failed"), { response: { status: 403 } })],
  ])("falls back to a fresh login when Garmin rejects the OAuth1 token (%s)", async (_label, rejection) => {
    connectionMocks.getGarminConnection.mockResolvedValue(conn(EXPIRED));
    FakeGarminConnect.refreshImpl = () => Promise.reject(rejection());

    const res = await request(app).post("/api/v1/garmin/sync");

    expect(res.status).toBe(200);
    expect(FakeGarminConnect.instances[0].login).toHaveBeenCalledWith(FIXTURE_EMAIL, FIXTURE_PW);
    expect(connectionMocks.updateGarminTokens).toHaveBeenCalledTimes(1);
    expect(connectionMocks.setGarminError).not.toHaveBeenCalled();
  });

  it.each([
    ["a network failure", () => new Error("socket hang up"), /did not respond/],
    ["a 429", () => Object.assign(new Error("Request failed"), { response: { status: 429 } }), /rate limits/],
  ])("answers 502 and keeps the connection when the refresh hits %s", async (_label, failure, message) => {
    connectionMocks.getGarminConnection.mockResolvedValue(conn(EXPIRED));
    FakeGarminConnect.refreshImpl = () => Promise.reject(failure());

    const res = await request(app).post("/api/v1/garmin/sync");

    const body = res.body as { code?: string; error?: string };
    expect(res.status).toBe(502);
    expect(body.code).toBe("GARMIN_API_ERROR");
    expect(body.error).toMatch(message);
    // No SSO attempt, and no lastError: setGarminError would wipe the credentials.
    expect(FakeGarminConnect.instances[0].login).not.toHaveBeenCalled();
    expect(connectionMocks.setGarminError).not.toHaveBeenCalled();
    expect(connectionMocks.updateGarminLastSync).not.toHaveBeenCalled();
  });

  it("takes the login path when there are no cached tokens at all", async () => {
    connectionMocks.getGarminConnection.mockResolvedValue(conn(NO_CACHED_TOKENS));

    const res = await request(app).post("/api/v1/garmin/sync");

    expect(res.status).toBe(200);
    expect(FakeGarminConnect.instances[0].client.refreshOauth2Token).not.toHaveBeenCalled();
    expect(FakeGarminConnect.instances[0].login).toHaveBeenCalled();
  });

  it("fails fast on a stored lastError before any SDK call (direct client layer)", async () => {
    vi.mocked(storage.users.getGarminConnection).mockResolvedValue(
      conn({ lastError: "Garmin rejected the credentials." }),
    );

    await expect(__testing.getGarminClient("user-1", logger)).rejects.toThrow(
      /Disconnect and reconnect to retry/,
    );
    expect(FakeGarminConnect.instances).toHaveLength(0);
  });

  it("rejects when credentials are no longer stored", async () => {
    vi.mocked(storage.users.getGarminConnection).mockResolvedValue(conn({ encryptedEmail: null }));

    await expect(__testing.getGarminClient("user-1", logger)).rejects.toThrow(/no longer stored/);
  });
});

describe("circuit breaker integration", () => {
  it("trips on a 429 login, records a friendly error, and short-circuits the next sync with 503", async () => {
    vi.mocked(storage.users.getGarminConnection).mockResolvedValue(
      conn(NO_CACHED_TOKENS), // forces the login path
    );
    FakeGarminConnect.loginImpl = () =>
      Promise.reject(new Error("Request failed: 429 Too Many Requests"));

    const first = await request(app).post("/api/v1/garmin/sync");

    expect(first.status).toBe(401);
    expect(first.body.code).toBe("GARMIN_AUTH_FAILED");
    expect(first.body.error).toMatch(/rate limit/i);
    expect(storage.users.setGarminError).toHaveBeenCalledWith(
      "user-1",
      expect.stringMatching(/rate limit/i),
    );
    expect(__testing.garminCircuitBreaker.isOpen()).toBe(true);

    const callsAfterFirst = vi.mocked(storage.users.getGarminConnection).mock.calls.length;
    const second = await request(app).post("/api/v1/garmin/sync");

    expect(second.status).toBe(503);
    expect(second.body.code).toBe("GARMIN_CIRCUIT_OPEN");
    // Short-circuited before any storage read.
    expect(vi.mocked(storage.users.getGarminConnection).mock.calls).toHaveLength(callsAfterFirst);
  });

  // The route-level check reads only this instance's copy of the breaker; a
  // trip recorded by a sibling instance is first seen inside withCircuitBreaker
  // (W14). These tests trip the breaker just after the route-level check to
  // stand in for that adoption. Garmin never sees the request, so the stored
  // connection must survive: setGarminError would also wipe the credentials.
  function tripAfterRouteCheck(): void {
    __testing.garminCircuitBreaker.trip("adopted from a sibling instance");
  }

  it("answers 503 and keeps the connection when the breaker blocks the activity fetch", async () => {
    vi.mocked(storage.users.getGarminConnection).mockImplementation(() => {
      tripAfterRouteCheck();
      return Promise.resolve(conn());
    });

    const res = await request(app).post("/api/v1/garmin/sync");

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("GARMIN_CIRCUIT_OPEN");
    expect(storage.users.setGarminError).not.toHaveBeenCalled();
    expect(FakeGarminConnect.instances[0].getActivities).not.toHaveBeenCalled();
  });

  it("answers 503 and keeps the connection when the breaker blocks the sync login", async () => {
    vi.mocked(storage.users.getGarminConnection).mockImplementation(() => {
      tripAfterRouteCheck();
      return Promise.resolve(conn(NO_CACHED_TOKENS)); // forces the login path
    });

    const res = await request(app).post("/api/v1/garmin/sync");

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("GARMIN_CIRCUIT_OPEN");
    expect(storage.users.setGarminError).not.toHaveBeenCalled();
    expect(FakeGarminConnect.instances[0].login).not.toHaveBeenCalled();
  });

  it("answers 503, not a credentials error, when the breaker blocks the /connect login", async () => {
    FakeGarminConnect.onConstruct = tripAfterRouteCheck;
    const res = await request(app)
      .post("/api/v1/garmin/connect")
      .send({ email: FIXTURE_EMAIL, password: FIXTURE_PW });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe("GARMIN_CIRCUIT_OPEN");
    expect(FakeGarminConnect.instances[0].login).not.toHaveBeenCalled();
    expect(storage.users.upsertGarminConnection).not.toHaveBeenCalled();
  });
});

describe("sync preflight", () => {
  const FIXED_NOW = new Date("2026-07-19T12:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  it("404s when not connected", () => {
    const res = mockRes();
    expect(__testing.rejectSyncPreflight(res, undefined as never)).toBe(true);
    expect((res as { statusCode: number }).statusCode).toBe(404);
    expect((res as { body: { code: string } }).body.code).toBe("GARMIN_NOT_CONNECTED");
  });

  it("429s inside the min-sync interval and passes at the boundary", () => {
    const tooSoon = mockRes();
    expect(
      __testing.rejectSyncPreflight(
        tooSoon,
        conn({ lastSyncedAt: new Date(FIXED_NOW.getTime() - 60_000) }),
      ),
    ).toBe(true);
    expect((tooSoon as { statusCode: number }).statusCode).toBe(429);
    expect((tooSoon as { body: { error: string } }).body.error).toMatch(/wait 4 more minutes/);

    const boundary = mockRes();
    expect(
      __testing.rejectSyncPreflight(
        boundary,
        conn({ lastSyncedAt: new Date(FIXED_NOW.getTime() - __testing.MIN_SYNC_INTERVAL_MS) }),
      ),
    ).toBe(false);
  });

  it("401s on a stored lastError and passes a healthy connection", () => {
    const broken = mockRes();
    expect(__testing.rejectSyncPreflight(broken, conn({ lastError: "bad" }))).toBe(true);
    expect((broken as { statusCode: number }).statusCode).toBe(401);
    expect((broken as { body: { code: string } }).body.code).toBe("GARMIN_RECONNECT_REQUIRED");

    expect(__testing.rejectSyncPreflight(mockRes(), conn())).toBe(false);
  });
});

describe("per-user in-flight lock", () => {
  it("returns 409 GARMIN_BUSY while a sync is in flight", async () => {
    vi.mocked(storage.users.getGarminConnection).mockResolvedValue(conn());
    let release!: () => void;
    FakeGarminConnect.getActivitiesImpl = () =>
      new Promise((resolve) => {
        release = () => resolve([]);
      });

    // supertest is lazy — .then() dispatches the request without awaiting it.
    const first = request(app)
      .post("/api/v1/garmin/sync")
      .then((r) => r);
    await vi.waitFor(() => expect(__testing.inFlightUsers.has("user-1")).toBe(true));

    const second = await request(app).post("/api/v1/garmin/sync");
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("GARMIN_BUSY");

    release();
    expect((await first).status).toBe(200);
  });
});

describe("translateGarminError", () => {
  it.each([
    ["Request failed: 429 Too Many Requests", /rate limit/i],
    ["Unexpected status 401", /credentials|rejected/i],
    ["MFA ticket required", /multi-factor|MFA/i],
    ["something else entirely", /disconnect and reconnect/i],
  ])("maps %s to a friendly message", (raw, expected) => {
    expect(__testing.translateGarminError(new Error(raw))).toMatch(expected);
  });

  // Every branch ends with "disconnect and reconnect", so the credentials
  // message is only distinguishable by its own wording.
  const CREDENTIALS_MESSAGE = /rejected the credentials/i;

  it.each([
    "Activity 8401123 could not be parsed",
    "Synced 1401 activities but the last page failed",
    "Upload of 4013 samples timed out",
  ])("does not blame the athlete's credentials for %s", (raw) => {
    // A loose includes("401") matched any error whose text merely contained
    // those digits and told the athlete to re-enter a password that was never
    // the problem.
    expect(__testing.translateGarminError(new Error(raw))).not.toMatch(CREDENTIALS_MESSAGE);
  });

  it("still reads a structured 401/403 status even when the message says nothing", () => {
    const err = Object.assign(new Error("request failed"), { status: 401 });
    expect(__testing.translateGarminError(err)).toMatch(CREDENTIALS_MESSAGE);
    const forbidden = Object.assign(new Error("request failed"), { response: { status: 403 } });
    expect(__testing.translateGarminError(forbidden)).toMatch(CREDENTIALS_MESSAGE);
  });
});
