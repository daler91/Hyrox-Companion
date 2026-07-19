import type { GarminConnect as GarminConnectType } from "@flow-js/garmin-connect";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __testing, registerGarminRoutes } from "./garmin";
import { logger } from "./logger";
import { clearRateLimitBuckets } from "./routeUtils";
import { createTestApp } from "./routes/__tests__/testUtils";
import { storage } from "./storage";

/**
 * Orchestration tests for the Garmin sync flow — the seven-safety-layer side
 * of garmin.ts that garmin.test.ts (primitives) and garminMapper.test.ts
 * (pure mapping) don't reach. The SDK is injected through the
 * __testing.setGarminConnectCtor seam because the real module is loaded via
 * createRequire at module scope, out of vi.mock's reach.
 */

vi.mock("./storage", () => ({
  storage: {
    users: {
      getGarminConnection: vi.fn(),
      setGarminError: vi.fn().mockResolvedValue(undefined),
      updateGarminTokens: vi.fn().mockResolvedValue(undefined),
      updateGarminLastSync: vi.fn().mockResolvedValue(undefined),
      upsertGarminConnection: vi.fn().mockResolvedValue(undefined),
      deleteGarminConnection: vi.fn().mockResolvedValue(undefined),
      getUser: vi.fn(),
    },
    workouts: {
      getExistingGarminActivityIds: vi.fn(),
      createGarminWorkoutLogs: vi.fn(),
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
vi.mock("./sharedRuntimeState", () => ({
  getRuntimeCache: vi.fn().mockResolvedValue(null),
  setRuntimeCache: vi.fn().mockResolvedValue(undefined),
}));

// Fake SDK injected through the constructor seam.
class FakeGarminConnect {
  static instances: FakeGarminConnect[] = [];
  static loginImpl: () => Promise<unknown> = () => Promise.resolve(undefined);
  static getActivitiesImpl: () => Promise<unknown> = () => Promise.resolve([]);
  static reset(): void {
    this.instances = [];
    this.loginImpl = () => Promise.resolve(undefined);
    this.getActivitiesImpl = () => Promise.resolve([]);
  }

  login = vi.fn((_email?: string, _password?: string) => FakeGarminConnect.loginImpl());
  loadToken = vi.fn();
  getActivities = vi.fn(() => FakeGarminConnect.getActivitiesImpl());
  getUserProfile = vi.fn(() => Promise.resolve({ displayName: "Test Athlete" }));
  exportToken = vi.fn(() => ({
    oauth1: { oauth_token: "o1" },
    oauth2: { access_token: "o2", expires_at: Math.floor(Date.now() / 1000) + 3600 },
  }));

  constructor(public opts: { username: string; password: string }) {
    FakeGarminConnect.instances.push(this);
  }
}

function conn(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user-1",
    garminDisplayName: "Test Athlete",
    // Storage decrypts in place — plaintext despite the column names.
    encryptedEmail: "a@example.com",
    encryptedPassword: "pw",
    encryptedOauth1Token: JSON.stringify({ oauth_token: "o1" }),
    encryptedOauth2Token: JSON.stringify({ access_token: "o2" }),
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000), // fresh (> 5-min buffer)
    lastSyncedAt: null,
    lastError: null,
    ...overrides,
  } as never;
}

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
  });

  it("translates a non-array activities response into 502 GARMIN_API_ERROR and records the error", async () => {
    vi.mocked(storage.users.getGarminConnection).mockResolvedValue(conn());
    FakeGarminConnect.getActivitiesImpl = () => Promise.resolve({ error: "maintenance" });

    const res = await request(app).post("/api/v1/garmin/sync");

    expect(res.status).toBe(502);
    expect(res.body.code).toBe("GARMIN_API_ERROR");
    expect(storage.users.setGarminError).toHaveBeenCalled();
    expect(storage.users.updateGarminLastSync).not.toHaveBeenCalled();
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
    expect(client.login).toHaveBeenCalledWith("a@example.com", "pw");
    expect(storage.users.updateGarminTokens).toHaveBeenCalledWith(
      "user-1",
      JSON.stringify({ oauth_token: "o1" }),
      expect.stringContaining('"access_token":"o2"'),
      expect.any(Date),
    );
  });

  it("takes the login path when cached tokens are expired", async () => {
    vi.mocked(storage.users.getGarminConnection).mockResolvedValue(
      conn({ tokenExpiresAt: new Date(Date.now() - 1000) }),
    );

    const res = await request(app).post("/api/v1/garmin/sync");

    expect(res.status).toBe(200);
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
      conn({ tokenExpiresAt: null }), // forces the login path
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
    expect(vi.mocked(storage.users.getGarminConnection).mock.calls.length).toBe(callsAfterFirst);
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
});
