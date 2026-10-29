import type express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearRateLimitBuckets } from "../../routeUtils";
import { storage } from "../../storage";
import pushRouter from "../push";
import { createTestApp, TEST_USER_ID } from "./testUtils";

vi.mock("../../clerkAuth", async () => (await import("./testUtils")).mockClerkAuthModule());

vi.mock("../../types", async () => (await import("./testUtils")).mockTypesModule());

vi.mock("../../storage", async () =>
  (await import("./testUtils")).mockStorageModule({
    push: ["saveSubscription", "removeSubscription", "getSubscriptionsForUser", "removeById"],
  }),
);

const KEYS = { p256dh: "BPubKey", auth: "authSecret" };
// A push service reached over plain http: the insecure scheme is what the
// subscribe validation must refuse.
const INSECURE_SCHEME = "http";

describe("POST /api/v1/push/subscribe (S2 CODEBASE_ANALYSIS_2026-10-03: push-service allowlist)", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    clearRateLimitBuckets();
    app = createTestApp(pushRouter);
  });

  it.each([
    "https://fcm.googleapis.com/fcm/send/abc:APA91b",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAAA",
    "https://web.push.apple.com/QGuQyavXutnMOn_W",
    "https://wns2-par02p.notify.windows.com/w/?token=BQYAAA",
  ])("accepts a browser push service endpoint (%s)", async (endpoint) => {
    vi.mocked(storage.push.saveSubscription).mockResolvedValue(undefined);

    const response = await request(app).post("/api/v1/push/subscribe").send({ endpoint, keys: KEYS });

    expect(response.status).toBe(200);
    expect(storage.push.saveSubscription).toHaveBeenCalledWith(TEST_USER_ID, { endpoint, ...KEYS });
  });

  it.each([
    "https://evil.example/p",
    "https://fcm.googleapis.com.evil.example/fcm/send/abc",
    "https://evilfcm.googleapis.com/fcm/send/abc",
    // web-push's url.parse() would connect to evil.example / 127.0.0.1 here. DevSkim: ignore DS162092
    "https://evil.example%2eweb.push.apple.com/p",
    "https://evil.example;web.push.apple.com/p",
    "https://127.0.0.1%2eweb.push.apple.com/p", // DevSkim: ignore DS162092
  ])("rejects an endpoint outside the known push services (%s)", async (endpoint) => {
    const response = await request(app).post("/api/v1/push/subscribe").send({ endpoint, keys: KEYS });

    expect(response.status).toBe(400);
    expect(storage.push.saveSubscription).not.toHaveBeenCalled();
  });

  it("still rejects a plain-http push service endpoint", async () => {
    const response = await request(app)
      .post("/api/v1/push/subscribe")
      .send({ endpoint: `${INSECURE_SCHEME}://fcm.googleapis.com/fcm/send/abc`, keys: KEYS });

    expect(response.status).toBe(400);
    expect(storage.push.saveSubscription).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/push/subscribe (persisted-string length bounds)", () => {
  let app: express.Express;
  const ENDPOINT_PREFIX = "https://fcm.googleapis.com/fcm/send/";

  beforeEach(() => {
    vi.clearAllMocks();
    clearRateLimitBuckets();
    app = createTestApp(pushRouter);
  });

  it("accepts an endpoint of exactly 2048 characters", async () => {
    vi.mocked(storage.push.saveSubscription).mockResolvedValue(undefined);
    const endpoint = ENDPOINT_PREFIX + "a".repeat(2048 - ENDPOINT_PREFIX.length);

    const response = await request(app).post("/api/v1/push/subscribe").send({ endpoint, keys: KEYS });

    expect(response.status).toBe(200);
    expect(storage.push.saveSubscription).toHaveBeenCalledWith(TEST_USER_ID, { endpoint, ...KEYS });
  });

  it("rejects an endpoint longer than 2048 characters", async () => {
    const endpoint = ENDPOINT_PREFIX + "a".repeat(2049 - ENDPOINT_PREFIX.length);

    const response = await request(app).post("/api/v1/push/subscribe").send({ endpoint, keys: KEYS });

    expect(response.status).toBe(400);
    expect(storage.push.saveSubscription).not.toHaveBeenCalled();
  });

  it.each(["p256dh", "auth"] as const)("accepts a %s key of exactly 512 characters", async (field) => {
    vi.mocked(storage.push.saveSubscription).mockResolvedValue(undefined);
    const keys = { ...KEYS, [field]: "k".repeat(512) };
    const endpoint = `${ENDPOINT_PREFIX}abc`;

    const response = await request(app).post("/api/v1/push/subscribe").send({ endpoint, keys });

    expect(response.status).toBe(200);
    expect(storage.push.saveSubscription).toHaveBeenCalledWith(TEST_USER_ID, { endpoint, ...keys });
  });

  it.each(["p256dh", "auth"] as const)("rejects a %s key longer than 512 characters", async (field) => {
    const keys = { ...KEYS, [field]: "k".repeat(513) };

    const response = await request(app)
      .post("/api/v1/push/subscribe")
      .send({ endpoint: `${ENDPOINT_PREFIX}abc`, keys });

    expect(response.status).toBe(400);
    expect(storage.push.saveSubscription).not.toHaveBeenCalled();
  });
});
