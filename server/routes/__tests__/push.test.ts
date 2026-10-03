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
    // web-push's url.parse() would connect to evil.example / 127.0.0.1 here.
    "https://evil.example%2eweb.push.apple.com/p",
    "https://evil.example;web.push.apple.com/p",
    "https://127.0.0.1%2eweb.push.apple.com/p",
  ])("rejects an endpoint outside the known push services (%s)", async (endpoint) => {
    const response = await request(app).post("/api/v1/push/subscribe").send({ endpoint, keys: KEYS });

    expect(response.status).toBe(400);
    expect(storage.push.saveSubscription).not.toHaveBeenCalled();
  });

  it("still rejects a plain-http push service endpoint", async () => {
    const response = await request(app)
      .post("/api/v1/push/subscribe")
      .send({ endpoint: "http://fcm.googleapis.com/fcm/send/abc", keys: KEYS });

    expect(response.status).toBe(400);
    expect(storage.push.saveSubscription).not.toHaveBeenCalled();
  });
});
