import { beforeEach, describe, expect, it, vi } from "vitest";

// The native (FCM) half of sendPushToUser. pushNotifications.test.ts covers the
// web half with VAPID configured; here both channels are on and FCM itself is
// stubbed (server/fcm.test.ts covers the FCM client).

const { sendFcmMessageMock, sendNotificationMock, fcmConfigured } = vi.hoisted(() => ({
  sendFcmMessageMock: vi.fn(),
  sendNotificationMock: vi.fn(),
  fcmConfigured: { value: true },
}));

vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: sendNotificationMock },
}));
vi.mock("./env", () => ({
  env: { VAPID_PUBLIC_KEY: "test-public-key", VAPID_PRIVATE_KEY: "test-private-key", VAPID_EMAIL: "ops@example.com" },
}));
vi.mock("./fcm", () => ({
  isFcmConfigured: () => fcmConfigured.value,
  sendFcmMessage: sendFcmMessageMock,
}));
vi.mock("./logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("./ssrfGuard", () => ({ assertResolvedHostIsPublic: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./storage", () => ({
  storage: {
    push: {
      getSubscriptionsForUser: vi.fn(),
      removeById: vi.fn(),
      getDeviceTokensForUser: vi.fn(),
      removeDeviceTokenById: vi.fn(),
    },
  },
}));

import { isNativePushEnabled, isPushEnabled, isWebPushEnabled, sendPushToUser } from "./pushNotifications";
import { storage } from "./storage";

const SUB = { id: "sub-1", endpoint: "https://fcm.googleapis.com/fcm/send/x", p256dh: "p256dh", auth: "auth" };
const PHONE = { id: "dev-1", platform: "android", token: "tok-phone" };
const TABLET = { id: "dev-2", platform: "android", token: "tok-tablet" };

describe("sendPushToUser with native push configured", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fcmConfigured.value = true;
    vi.mocked(storage.push.getSubscriptionsForUser).mockResolvedValue([SUB]);
    vi.mocked(storage.push.getDeviceTokensForUser).mockResolvedValue([PHONE, TABLET]);
    sendNotificationMock.mockResolvedValue(undefined);
  });

  it("delivers to every browser subscription and every app install, and counts both", async () => {
    sendFcmMessageMock.mockResolvedValue("sent");
    const payload = { title: "Today: Threshold", body: "~55 min", url: "/?workout=pd-1", category: "training" as const };

    const sent = await sendPushToUser("user-1", payload);

    expect(sent).toBe(3);
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    expect(sendFcmMessageMock).toHaveBeenCalledWith("dev-1", "tok-phone", payload);
    expect(sendFcmMessageMock).toHaveBeenCalledWith("dev-2", "tok-tablet", payload);
  });

  it("prunes an install FCM reports as stale and does not count it", async () => {
    sendFcmMessageMock.mockImplementation((id: string) => Promise.resolve(id === "dev-1" ? "stale" : "sent"));

    const sent = await sendPushToUser("user-1", { title: "T", body: "B" });

    expect(sent).toBe(2);
    expect(storage.push.removeDeviceTokenById).toHaveBeenCalledWith("dev-1");
    expect(storage.push.removeDeviceTokenById).toHaveBeenCalledTimes(1);
  });

  it("keeps an install whose send merely failed", async () => {
    sendFcmMessageMock.mockResolvedValue("failed");

    const sent = await sendPushToUser("user-1", { title: "T", body: "B" });

    expect(sent).toBe(1);
    expect(storage.push.removeDeviceTokenById).not.toHaveBeenCalled();
  });

  it("does not read device tokens when native push is not configured", async () => {
    fcmConfigured.value = false;

    const sent = await sendPushToUser("user-1", { title: "T", body: "B" });

    expect(sent).toBe(1);
    expect(storage.push.getDeviceTokensForUser).not.toHaveBeenCalled();
    expect(sendFcmMessageMock).not.toHaveBeenCalled();
  });

  it("reports each channel's configuration separately", () => {
    expect(isWebPushEnabled()).toBe(true);
    expect(isNativePushEnabled()).toBe(true);
    expect(isPushEnabled()).toBe(true);
  });
});
