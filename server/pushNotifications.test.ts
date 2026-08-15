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

import { storage } from "./storage";

const SUB = { id: "sub-1", endpoint: "https://push.example.com/x", p256dh: "p256dh", auth: "auth" };

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
