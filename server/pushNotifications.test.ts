import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared mocks. Hoisted so the vi.mock factories below can reference them —
// factories run before top-level consts are evaluated.
const { sendNotificationMock, removeByIdMock, assertResolvedHostIsPublicMock } = vi.hoisted(() => ({
  sendNotificationMock: vi.fn(),
  removeByIdMock: vi.fn(),
  assertResolvedHostIsPublicMock: vi.fn(),
}));

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: sendNotificationMock,
  },
}));

vi.mock("./env", () => ({
  env: {
    VAPID_PUBLIC_KEY: "test-public-key",
    VAPID_PRIVATE_KEY: "test-private-key",
    VAPID_EMAIL: "ops@example.com",
  },
}));

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// The real ssrfGuard is exercised by ssrfGuard.test.ts; here we stub it so
// this suite can assert pushNotifications.ts actually *calls* it and reacts
// to a rejection, without re-testing the IP-range logic itself.
vi.mock("./ssrfGuard", () => ({
  assertResolvedHostIsPublic: assertResolvedHostIsPublicMock,
}));

vi.mock("./storage", () => ({
  storage: {
    push: {
      getSubscriptionsForUser: vi.fn(),
      removeById: removeByIdMock,
    },
  },
}));

import { PUSH_SEND_TIMEOUT_MS } from "./constants";
import { storage } from "./storage";

const SUB = { id: "sub-1", endpoint: "https://fcm.googleapis.com/fcm/send/x", p256dh: "p256dh", auth: "auth" };

describe("sendPushToUser (S: DNS-rebinding SSRF guard)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.push.getSubscriptionsForUser).mockResolvedValue([SUB]);
  });

  it("re-validates the endpoint's DNS resolution immediately before sending", async () => {
    assertResolvedHostIsPublicMock.mockResolvedValue(undefined);
    sendNotificationMock.mockResolvedValue(undefined);

    const { sendPushToUser } = await import("./pushNotifications");
    const sent = await sendPushToUser("user-1", { title: "t", body: "b" });

    expect(assertResolvedHostIsPublicMock).toHaveBeenCalledWith(SUB.endpoint);
    expect(sendNotificationMock).toHaveBeenCalled();
    expect(sent).toBe(1);
  });

  it("removes the subscription and does NOT call web-push when the endpoint now resolves to a private IP (DNS rebinding)", async () => {
    assertResolvedHostIsPublicMock.mockRejectedValue(
      new Error(
        'Outbound URL host "evil.example.com" resolves to a private/loopback address (169.254.169.254) — refusing to start (SSRF guard S2)',
      ),
    );

    const { sendPushToUser } = await import("./pushNotifications");
    const sent = await sendPushToUser("user-1", { title: "t", body: "b" });

    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(removeByIdMock).toHaveBeenCalledWith(SUB.id);
    expect(sent).toBe(0);
  });
});

describe("sendPushToUser (S2 CODEBASE_ANALYSIS_2026-10-03: bounded sends to known push services)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertResolvedHostIsPublicMock.mockResolvedValue(undefined);
    sendNotificationMock.mockResolvedValue(undefined);
  });

  it("passes a socket timeout to web-push so a silent endpoint cannot hang the send", async () => {
    vi.mocked(storage.push.getSubscriptionsForUser).mockResolvedValue([SUB]);

    const { sendPushToUser } = await import("./pushNotifications");
    await sendPushToUser("user-1", { title: "t", body: "b" });

    expect(sendNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: SUB.endpoint }),
      expect.any(String),
      expect.objectContaining({ timeout: PUSH_SEND_TIMEOUT_MS }),
    );
  });

  it("removes and skips a stored subscription whose endpoint is not a known push service", async () => {
    const legacy = { ...SUB, id: "sub-evil", endpoint: "https://evil.example/p" };
    vi.mocked(storage.push.getSubscriptionsForUser).mockResolvedValue([legacy, SUB]);

    const { sendPushToUser } = await import("./pushNotifications");
    const sent = await sendPushToUser("user-1", { title: "t", body: "b" });

    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    expect(sendNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: SUB.endpoint }),
      expect.any(String),
      expect.anything(),
    );
    expect(assertResolvedHostIsPublicMock).not.toHaveBeenCalledWith(legacy.endpoint);
    expect(removeByIdMock).toHaveBeenCalledWith("sub-evil");
    expect(removeByIdMock).not.toHaveBeenCalledWith(SUB.id);
    expect(sent).toBe(1);
  });

  it("removes a stored row whose host only looks allowlisted to the WHATWG parser", async () => {
    // web-push connects to url.parse()'s hostname, which stops at the '%' and
    // would reach 127.0.0.1 here while new URL() sees a *.push.apple.com host.
    const spoofed = { ...SUB, id: "sub-spoof", endpoint: "https://127.0.0.1%2eweb.push.apple.com/p" };
    vi.mocked(storage.push.getSubscriptionsForUser).mockResolvedValue([spoofed]);

    const { sendPushToUser } = await import("./pushNotifications");
    const sent = await sendPushToUser("user-1", { title: "t", body: "b" });

    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(assertResolvedHostIsPublicMock).not.toHaveBeenCalled();
    expect(removeByIdMock).toHaveBeenCalledWith("sub-spoof");
    expect(sent).toBe(0);
  });
});

describe("isAllowedPushEndpoint (S2 CODEBASE_ANALYSIS_2026-10-03)", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc:APA91b",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAAAA",
    "https://push.services.mozilla.com/wpush/v2/gAAAAA",
    "https://web.push.apple.com/QGuQyavXutnMOn_W",
    "https://wns2-par02p.notify.windows.com/w/?token=BQYAAA",
    "https://db5p.notify.windows.com/w/?token=BQYAAA",
  ])("accepts the browser push service endpoint %s", async (endpoint) => {
    const { isAllowedPushEndpoint } = await import("./pushNotifications");
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    "https://evil.example/p",
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com.evil.example/fcm/send/abc",
    "https://evilfcm.googleapis.com/fcm/send/abc",
    "https://storage.googleapis.com/bucket/p",
    "https://evilpush.apple.com/p",
    "https://notify.windows.com.evil.example/w",
    "https://evil.example/fcm.googleapis.com",
    "https://fcm.googleapis.com@evil.example/p",
    // Hosts web-push's legacy url.parse() reads differently from new URL().
    "https://evil.example%2eweb.push.apple.com/p",
    "https://evil.example;web.push.apple.com/p",
    "https://127.0.0.1%2eweb.push.apple.com/p",
    "https://evil.example%2eupdates.push.services.mozilla.com/p",
    "https://evil.example%2ewns2-par02p.notify.windows.com/w",
    "not a url",
  ])("rejects %s", async (endpoint) => {
    const { isAllowedPushEndpoint } = await import("./pushNotifications");
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });
});
