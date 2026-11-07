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
    push: [
      "saveSubscription",
      "removeSubscription",
      "getSubscriptionsForUser",
      "removeById",
      "saveDeviceToken",
      "removeDeviceToken",
    ],
  }),
);

const pushConfig = vi.hoisted(() => ({ native: true }));
vi.mock("../../pushNotifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../pushNotifications")>()),
  isNativePushEnabled: () => pushConfig.native,
}));

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

describe("/api/v1/push/devices (native app installs)", () => {
  let app: express.Express;
  const FCM_TOKEN = "dQw4w9WgXcQ:APA91bH-1_example-token";

  beforeEach(() => {
    vi.clearAllMocks();
    clearRateLimitBuckets();
    pushConfig.native = true;
    app = createTestApp(pushRouter);
  });

  it("registers the install for the signed-in athlete with the app version from the header", async () => {
    vi.mocked(storage.push.saveDeviceToken).mockResolvedValue(undefined);

    const response = await request(app)
      .post("/api/v1/push/devices")
      .set("X-App-Platform", "android")
      .set("X-App-Version", "1.2.0")
      .send({ token: FCM_TOKEN, platform: "android" });

    expect(response.status).toBe(200);
    expect(storage.push.saveDeviceToken).toHaveBeenCalledWith(TEST_USER_ID, {
      token: FCM_TOKEN,
      platform: "android",
      appVersion: "1.2.0",
    });
  });

  it("stores no app version when the header is absent or malformed", async () => {
    vi.mocked(storage.push.saveDeviceToken).mockResolvedValue(undefined);

    await request(app)
      .post("/api/v1/push/devices")
      .set("X-App-Platform", "android")
      .set("X-App-Version", "not-a-version")
      .send({ token: FCM_TOKEN, platform: "android" });

    expect(storage.push.saveDeviceToken).toHaveBeenCalledWith(TEST_USER_ID, expect.objectContaining({ appVersion: null }));
  });

  it.each([
    ["an unknown platform", { token: FCM_TOKEN, platform: "windows" }],
    ["a token with characters FCM never uses", { token: "abc def<script>", platform: "android" }],
    ["an empty token", { token: "", platform: "android" }],
    ["an oversized token", { token: "a".repeat(4097), platform: "android" }],
  ])("rejects %s", async (_label, body) => {
    const response = await request(app).post("/api/v1/push/devices").send(body);

    expect(response.status).toBe(400);
    expect(storage.push.saveDeviceToken).not.toHaveBeenCalled();
  });

  it("answers PUSH_NOT_CONFIGURED when native push is off, so the app can say notifications are unavailable", async () => {
    pushConfig.native = false;

    const response = await request(app).post("/api/v1/push/devices").send({ token: FCM_TOKEN, platform: "android" });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe("PUSH_NOT_CONFIGURED");
    expect(storage.push.saveDeviceToken).not.toHaveBeenCalled();
  });

  it("unregisters the install for the signed-in athlete only", async () => {
    vi.mocked(storage.push.removeDeviceToken).mockResolvedValue(true);

    const response = await request(app).delete("/api/v1/push/devices").send({ token: FCM_TOKEN });

    expect(response.status).toBe(200);
    expect(storage.push.removeDeviceToken).toHaveBeenCalledWith(TEST_USER_ID, FCM_TOKEN);
  });
});
