import crypto from "node:crypto";

import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface MockEnv {
  APP_URL: string | undefined;
  STRAVA_CLIENT_ID: string | undefined;
  STRAVA_CLIENT_SECRET: string | undefined;
  STRAVA_AUTO_SYNC_ENABLED: string;
  STRAVA_WEBHOOKS_ENABLED: string;
  STRAVA_WEBHOOK_VERIFY_TOKEN: string | undefined;
}

const mocks = vi.hoisted(() => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const env: MockEnv = {
    APP_URL: "https://app.example.com",
    STRAVA_CLIENT_ID: "client-id",
    STRAVA_CLIENT_SECRET: "client-secret", // gitleaks:allow — fake test-only value, not a credential
    STRAVA_AUTO_SYNC_ENABLED: "true",
    STRAVA_WEBHOOKS_ENABLED: "true",
    STRAVA_WEBHOOK_VERIFY_TOKEN: undefined,
  };
  return {
    logger,
    env,
    enqueueStravaSync: vi.fn(),
    listStravaConnectionUsersByAthleteId: vi.fn(),
    getRuntimeCache: vi.fn(),
    setRuntimeCache: vi.fn(),
    deleteRuntimeCache: vi.fn(),
  };
});

vi.mock("./env", () => ({ env: mocks.env }));
vi.mock("./logger", () => ({ logger: mocks.logger, reqLogger: () => mocks.logger }));
vi.mock("./storage", () => ({
  storage: {
    users: { listStravaConnectionUsersByAthleteId: mocks.listStravaConnectionUsersByAthleteId },
  },
}));
vi.mock("./services/stravaSyncQueue", () => ({
  enqueueStravaSync: mocks.enqueueStravaSync,
  isStravaAutoSyncEnabled: () => mocks.env.STRAVA_AUTO_SYNC_ENABLED !== "false",
}));
vi.mock("./sharedRuntimeState", () => ({
  getRuntimeCache: mocks.getRuntimeCache,
  setRuntimeCache: mocks.setRuntimeCache,
  deleteRuntimeCache: mocks.deleteRuntimeCache,
}));
// The real limiter needs the shared Postgres store; the receiver's own
// behaviour is what these tests are about.
vi.mock("./routeUtils", () => ({
  rateLimiter: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  asyncHandler:
    (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) => {
      fn(req, res, next).catch(next);
    },
}));

import {
  __resetStravaWebhookStateForTests,
  ensureStravaWebhookSubscription,
  getStravaWebhookCallbackUrl,
  getStravaWebhookState,
  getStravaWebhookVerifyToken,
  processStravaWebhookEvent,
  registerStravaWebhookRoutes,
  resolveStravaWebhookConfig,
  STRAVA_WEBHOOK_PATH,
  type StravaWebhookEvent,
} from "./stravaWebhook";

const CALLBACK_URL = "https://app.example.com/api/v1/strava/webhook";
const STATE_KEY = "strava:webhook-subscription";

function derivedVerifyToken(secret = "client-secret"): string {
  return crypto.createHmac("sha256", secret).update("strava-webhook-verify-token").digest("hex");
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  registerStravaWebhookRoutes(app);
  return app;
}

const activityCreated: StravaWebhookEvent = {
  object_type: "activity",
  object_id: 9_001,
  aspect_type: "create",
  owner_id: 555,
  subscription_id: 42,
  event_time: 1_700_000_000,
  updates: {},
};

beforeEach(() => {
  __resetStravaWebhookStateForTests();
  mocks.env.APP_URL = "https://app.example.com";
  mocks.env.STRAVA_CLIENT_ID = "client-id";
  mocks.env.STRAVA_CLIENT_SECRET = "client-secret";
  mocks.env.STRAVA_AUTO_SYNC_ENABLED = "true";
  mocks.env.STRAVA_WEBHOOKS_ENABLED = "true";
  mocks.env.STRAVA_WEBHOOK_VERIFY_TOKEN = undefined;
  mocks.enqueueStravaSync.mockReset().mockResolvedValue({ enqueued: true, jobId: "job-1" });
  mocks.listStravaConnectionUsersByAthleteId.mockReset().mockResolvedValue([]);
  mocks.getRuntimeCache.mockReset().mockResolvedValue(undefined);
  mocks.setRuntimeCache.mockReset().mockResolvedValue(undefined);
  mocks.deleteRuntimeCache.mockReset().mockResolvedValue(undefined);
  for (const fn of Object.values(mocks.logger)) fn.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("webhook configuration", () => {
  it("derives a stable verify token from the client secret unless one is configured", () => {
    expect(getStravaWebhookVerifyToken()).toBe(derivedVerifyToken());
    expect(getStravaWebhookVerifyToken()).toBe(getStravaWebhookVerifyToken());

    mocks.env.STRAVA_WEBHOOK_VERIFY_TOKEN = "explicit-token";
    expect(getStravaWebhookVerifyToken()).toBe("explicit-token");

    mocks.env.STRAVA_WEBHOOK_VERIFY_TOKEN = undefined;
    mocks.env.STRAVA_CLIENT_SECRET = undefined;
    expect(getStravaWebhookVerifyToken()).toBeNull();
  });

  it("builds the callback URL only for a public https APP_URL", () => {
    expect(getStravaWebhookCallbackUrl()).toBe(CALLBACK_URL);

    mocks.env.APP_URL = "https://app.example.com/";
    expect(getStravaWebhookCallbackUrl()).toBe(CALLBACK_URL);

    // Plain http: Strava will not deliver to it.
    mocks.env.APP_URL = "http://app.example.com";
    expect(getStravaWebhookCallbackUrl()).toBeNull();

    // A loopback host (the dev default) is unreachable from Strava's side.
    mocks.env.APP_URL = "https://localhost"; // DevSkim: ignore DS162092
    expect(getStravaWebhookCallbackUrl()).toBeNull();

    // So is anything on a private range, via the shared SSRF guard.
    mocks.env.APP_URL = "https://10.0.0.5";
    expect(getStravaWebhookCallbackUrl()).toBeNull();

    mocks.env.APP_URL = undefined;
    expect(getStravaWebhookCallbackUrl()).toBeNull();
  });

  it("resolves the full config, or names the first missing piece", () => {
    expect(resolveStravaWebhookConfig()).toEqual({
      ok: true,
      config: {
        clientId: "client-id",
        clientSecret: "client-secret",
        callbackUrl: CALLBACK_URL,
        verifyToken: derivedVerifyToken(),
      },
    });

    mocks.env.APP_URL = "http://app.example.com";
    expect(resolveStravaWebhookConfig()).toEqual({ ok: false, reason: "app_url_not_public" });

    mocks.env.STRAVA_CLIENT_ID = undefined;
    expect(resolveStravaWebhookConfig()).toEqual({ ok: false, reason: "missing_credentials" });

    mocks.env.STRAVA_WEBHOOKS_ENABLED = "false";
    expect(resolveStravaWebhookConfig()).toEqual({ ok: false, reason: "webhooks_disabled" });

    mocks.env.STRAVA_AUTO_SYNC_ENABLED = "false";
    expect(resolveStravaWebhookConfig()).toEqual({ ok: false, reason: "auto_sync_disabled" });
  });
});

describe("GET /api/v1/strava/webhook (subscription validation)", () => {
  it("echoes hub.challenge for Strava's verify token", async () => {
    const res = await request(buildApp()).get(STRAVA_WEBHOOK_PATH).query({
      "hub.mode": "subscribe",
      "hub.verify_token": derivedVerifyToken(),
      "hub.challenge": "challenge-123",
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ "hub.challenge": "challenge-123" });
  });

  it("rejects a wrong token, a missing challenge, and an unknown mode", async () => {
    const app = buildApp();

    const wrongToken = await request(app).get(STRAVA_WEBHOOK_PATH).query({
      "hub.mode": "subscribe",
      "hub.verify_token": "not-ours",
      "hub.challenge": "abc",
    });
    expect(wrongToken.status).toBe(403);

    const noChallenge = await request(app)
      .get(STRAVA_WEBHOOK_PATH)
      .query({ "hub.mode": "subscribe", "hub.verify_token": derivedVerifyToken() });
    expect(noChallenge.status).toBe(403);

    const wrongMode = await request(app).get(STRAVA_WEBHOOK_PATH).query({
      "hub.mode": "unsubscribe",
      "hub.verify_token": derivedVerifyToken(),
      "hub.challenge": "abc",
    });
    expect(wrongMode.status).toBe(403);
  });
});

describe("POST /api/v1/strava/webhook (event receipt)", () => {
  it("acknowledges immediately and enqueues a sync for the athlete's account", async () => {
    mocks.listStravaConnectionUsersByAthleteId.mockResolvedValue([
      { userId: "user-1", requiresReauth: false },
    ]);

    const res = await request(buildApp()).post(STRAVA_WEBHOOK_PATH).send(activityCreated);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    await vi.waitFor(() =>
      expect(mocks.enqueueStravaSync).toHaveBeenCalledWith("user-1", "webhook"),
    );
    expect(mocks.listStravaConnectionUsersByAthleteId).toHaveBeenCalledWith("555");
  });

  it("acknowledges a malformed body without touching the queue", async () => {
    const res = await request(buildApp())
      .post(STRAVA_WEBHOOK_PATH)
      .send({ object_type: "activity", aspect_type: "create" });

    expect(res.status).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(mocks.enqueueStravaSync).not.toHaveBeenCalled();
    expect(mocks.logger.warn).toHaveBeenCalled();
  });
});

describe("processStravaWebhookEvent", () => {
  it("enqueues once per connected account behind the athlete id", async () => {
    mocks.listStravaConnectionUsersByAthleteId.mockResolvedValue([
      { userId: "user-1", requiresReauth: false },
      { userId: "user-2", requiresReauth: true },
      { userId: "user-3", requiresReauth: false },
    ]);

    await expect(processStravaWebhookEvent(activityCreated, mocks.logger)).resolves.toBe(
      "enqueued",
    );

    expect(mocks.enqueueStravaSync.mock.calls).toEqual([
      ["user-1", "webhook"],
      ["user-3", "webhook"],
    ]);
  });

  it("treats an athlete deauthorization as a sync so the engine's 401 handling tombstones it", async () => {
    mocks.listStravaConnectionUsersByAthleteId.mockResolvedValue([
      { userId: "user-1", requiresReauth: false },
    ]);

    const deauthorized: StravaWebhookEvent = {
      ...activityCreated,
      object_type: "athlete",
      aspect_type: "update",
      updates: { authorized: "false" },
    };
    await expect(processStravaWebhookEvent(deauthorized, mocks.logger)).resolves.toBe("enqueued");
    expect(mocks.enqueueStravaSync).toHaveBeenCalledWith("user-1", "webhook");
  });

  it("leaves activity deletions alone", async () => {
    await expect(
      processStravaWebhookEvent({ ...activityCreated, aspect_type: "delete" }, mocks.logger),
    ).resolves.toBe("ignored_delete");
    expect(mocks.listStravaConnectionUsersByAthleteId).not.toHaveBeenCalled();
  });

  it("ignores athletes nobody here connected", async () => {
    await expect(processStravaWebhookEvent(activityCreated, mocks.logger)).resolves.toBe(
      "unknown_owner",
    );
    expect(mocks.enqueueStravaSync).not.toHaveBeenCalled();
  });

  it("drops events for a subscription that is not ours", async () => {
    mocks.getRuntimeCache.mockResolvedValue({
      subscriptionId: 7,
      callbackUrl: CALLBACK_URL,
      verifiedAt: 1,
    });

    await expect(processStravaWebhookEvent(activityCreated, mocks.logger)).resolves.toBe(
      "ignored_subscription",
    );
    expect(mocks.listStravaConnectionUsersByAthleteId).not.toHaveBeenCalled();
  });

  it("does nothing when webhooks are switched off", async () => {
    mocks.env.STRAVA_WEBHOOKS_ENABLED = "false";

    await expect(processStravaWebhookEvent(activityCreated, mocks.logger)).resolves.toBe(
      "disabled",
    );
    expect(mocks.listStravaConnectionUsersByAthleteId).not.toHaveBeenCalled();
  });
});

describe("ensureStravaWebhookSubscription", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("creates the subscription when Strava holds none, and remembers it", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ id: 42 }, 201));

    const result = await ensureStravaWebhookSubscription(mocks.logger);

    expect(result).toEqual({ status: "created", subscriptionId: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const listUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(listUrl.pathname).toBe("/api/v3/push_subscriptions");
    expect(listUrl.searchParams.get("client_id")).toBe("client-id");

    const [createUrl, createInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(createUrl).toBe("https://www.strava.com/api/v3/push_subscriptions");
    expect(createInit.method).toBe("POST");
    const body = new URLSearchParams(createInit.body as string);
    expect(body.get("callback_url")).toBe(CALLBACK_URL);
    expect(body.get("verify_token")).toBe(derivedVerifyToken());
    expect(body.get("client_secret")).toBe("client-secret");

    expect(mocks.setRuntimeCache).toHaveBeenCalledWith(
      STATE_KEY,
      expect.objectContaining({ subscriptionId: 42, callbackUrl: CALLBACK_URL }),
      expect.any(Number),
    );
    // The fresh state is served from memory afterwards.
    await expect(getStravaWebhookState()).resolves.toMatchObject({ subscriptionId: 42 });
    expect(mocks.getRuntimeCache).not.toHaveBeenCalled();
  });

  it("re-verifies an existing subscription for our callback without creating another", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 7, callback_url: CALLBACK_URL }]));

    const result = await ensureStravaWebhookSubscription(mocks.logger);

    expect(result).toEqual({ status: "active", subscriptionId: 7 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.setRuntimeCache).toHaveBeenCalledWith(
      STATE_KEY,
      expect.objectContaining({ subscriptionId: 7 }),
      expect.any(Number),
    );
  });

  it("never steals a subscription that points at another deployment", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ id: 9, callback_url: "https://staging.example.com/api/v1/strava/webhook" }]),
    );

    const result = await ensureStravaWebhookSubscription(mocks.logger);

    expect(result).toEqual({
      status: "mismatch",
      subscriptionId: 9,
      existingCallbackUrl: "https://staging.example.com/api/v1/strava/webhook",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.deleteRuntimeCache).toHaveBeenCalledWith(STATE_KEY);
    expect(mocks.logger.error).toHaveBeenCalled();
    await expect(getStravaWebhookState()).resolves.toBeNull();
  });

  it("reports an upstream failure without throwing or leaking the request", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "nope" }, 500));

    await expect(ensureStravaWebhookSubscription(mocks.logger)).resolves.toEqual({
      status: "failed",
    });
    const [, logged] = mocks.logger.error.mock.calls[0] as [Record<string, unknown>, string];
    expect(logged).toContain("subscription check failed");
    const err = (mocks.logger.error.mock.calls[0] as [{ err: Error }])[0].err;
    expect(err.message).not.toContain("client-secret");
  });

  it("treats a network failure the same way", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(ensureStravaWebhookSubscription(mocks.logger)).resolves.toEqual({
      status: "failed",
    });
  });

  it("stays out of Strava's way when the deployment cannot receive webhooks", async () => {
    mocks.env.APP_URL = "http://app.example.com";

    await expect(ensureStravaWebhookSubscription(mocks.logger)).resolves.toEqual({
      status: "disabled",
      reason: "app_url_not_public",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(getStravaWebhookState()).resolves.toBeNull();
  });
});
