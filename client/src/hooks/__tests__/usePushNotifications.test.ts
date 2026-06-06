import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiRequest } from "@/lib/queryClient";

import { usePushNotifications } from "../usePushNotifications";

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
}));

describe("usePushNotifications", () => {
  let originalNavigator: any;
  let originalNotification: any;
  let originalPushManager: any;
  let mockPushManager: any;

  beforeEach(() => {
    vi.clearAllMocks();

    originalNavigator = globalThis.navigator;
    originalNotification = globalThis.Notification;
    originalPushManager = (globalThis as any).PushManager;

    mockPushManager = {
      getSubscription: vi.fn().mockResolvedValue(null),
      subscribe: vi.fn(),
    };

    Object.defineProperty(globalThis, "navigator", {
      value: {
        serviceWorker: {
          ready: Promise.resolve({
            pushManager: mockPushManager,
          }),
        },
      },
      writable: true,
      configurable: true
    });

    Object.defineProperty(globalThis, "Notification", {
      value: {
        permission: "default",
        requestPermission: vi.fn().mockResolvedValue("granted"),
      },
      writable: true,
      configurable: true
    });

    Object.defineProperty(globalThis, "PushManager", {
      value: {},
      writable: true,
      configurable: true
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ publicKey: "BEl6tAMq" }),
    }) as any;
  });

  afterEach(() => {
    if (originalNavigator) {
      Object.defineProperty(globalThis, "navigator", { value: undefined, writable: true, configurable: true }); Object.defineProperty(globalThis, "navigator", {
        value: originalNavigator,
        writable: true,
        configurable: true
      });
    } else {
      delete (globalThis as any).navigator;
    }

    if (originalNotification) {
      Object.defineProperty(globalThis, "Notification", {
        value: originalNotification,
        writable: true,
        configurable: true
      });
    } else {
      delete (globalThis as any).Notification;
    }

    if (originalPushManager) {
      Object.defineProperty(globalThis, "PushManager", {
        value: originalPushManager,
        writable: true,
        configurable: true
      });
    } else {
      delete (globalThis as any).PushManager;
    }
  });

  it("handles pushManager.subscribe errors gracefully", async () => {
    mockPushManager.subscribe.mockRejectedValue(new Error("Subscription failed"));

    const { result } = renderHook(() => usePushNotifications());

    // Wait for the initial effect to complete
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    let success;
    await act(async () => {
      success = await result.current.subscribe();
    });

    expect(success).toBe(false);
    expect(result.current.isSubscribed).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(mockPushManager.subscribe).toHaveBeenCalled();
  });

  it("subscribes successfully", async () => {
    mockPushManager.subscribe.mockResolvedValue({
      toJSON: () => ({
        endpoint: "https://push.example.com",
        keys: { p256dh: "p256dh-key", auth: "auth-key" }
      })
    });
    vi.mocked(apiRequest).mockResolvedValue(true as any);

    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    let success;
    await act(async () => {
      success = await result.current.subscribe();
    });

    expect(success).toBe(true);
    expect(result.current.isSubscribed).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(mockPushManager.subscribe).toHaveBeenCalled();
    expect(apiRequest).toHaveBeenCalledWith("POST", "/api/v1/push/subscribe", {
      endpoint: "https://push.example.com",
      keys: { p256dh: "p256dh-key", auth: "auth-key" }
    });
  });

  it("handles pushManager.unsubscribe errors gracefully", async () => {
    const mockSubscription = {
      endpoint: "https://push.example.com",
      unsubscribe: vi.fn().mockRejectedValue(new Error("Unsubscribe failed")),
    };
    mockPushManager.getSubscription.mockResolvedValue(mockSubscription);

    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    let success;
    await act(async () => {
      success = await result.current.unsubscribe();
    });

    expect(success).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(mockSubscription.unsubscribe).toHaveBeenCalled();
  });

  it("unsubscribes successfully", async () => {
    const mockSubscription = {
      endpoint: "https://push.example.com",
      unsubscribe: vi.fn().mockResolvedValue(true),
    };
    mockPushManager.getSubscription.mockResolvedValue(mockSubscription);
    vi.mocked(apiRequest).mockResolvedValue(true as any);

    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    let success;
    await act(async () => {
      success = await result.current.unsubscribe();
    });

    expect(success).toBe(true);
    expect(result.current.isSubscribed).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(mockSubscription.unsubscribe).toHaveBeenCalled();
    expect(apiRequest).toHaveBeenCalledWith("DELETE", "/api/v1/push/unsubscribe", {
      endpoint: "https://push.example.com",
    });
  });

  it("returns false early if not supported", async () => {
    delete (globalThis as any).PushManager; // simulate no support

    const { result } = renderHook(() => usePushNotifications());

    let success;
    await act(async () => {
      success = await result.current.subscribe();
    });

    expect(success).toBe(false);
    expect(result.current.isSubscribed).toBe(false);
    expect(mockPushManager.subscribe).not.toHaveBeenCalled();
  });

  it("handles pushManager.unsubscribe when no subscription exists", async () => {
    mockPushManager.getSubscription.mockResolvedValue(null);

    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    let success;
    await act(async () => {
      success = await result.current.unsubscribe();
    });

    expect(success).toBe(true);
    expect(result.current.isSubscribed).toBe(false);
  });

  it("sends test notification successfully", async () => {
    vi.mocked(apiRequest).mockResolvedValue(true as any);

    const { result } = renderHook(() => usePushNotifications());

    let success;
    await act(async () => {
      success = await result.current.sendTestNotification();
    });

    expect(success).toBe(true);
    expect(apiRequest).toHaveBeenCalledWith("POST", "/api/v1/push/test");
  });

  it("handles send test notification failure", async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error("Test notification failed"));

    const { result } = renderHook(() => usePushNotifications());

    let success;
    await act(async () => {
      success = await result.current.sendTestNotification();
    });

    expect(success).toBe(false);
  });


  it("handles pushManager.subscribe permission denied", async () => {
    (globalThis.Notification as any).requestPermission.mockResolvedValue("denied");

    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    let success;
    await act(async () => {
      success = await result.current.subscribe();
    });

    expect(success).toBe(false);
    expect(result.current.permission).toBe("denied");
    expect(mockPushManager.subscribe).not.toHaveBeenCalled();
  });

  it("handles pushManager.subscribe vapid key fetch failure", async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: false,
    });

    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    let success;
    await act(async () => {
      success = await result.current.subscribe();
    });

    expect(success).toBe(false);
    expect(mockPushManager.subscribe).not.toHaveBeenCalled();
  });



  it("handles when push is not supported during unsubscribe", async () => {
    delete (globalThis as any).PushManager; // simulate no support

    const { result } = renderHook(() => usePushNotifications());

    let success;
    await act(async () => {
      success = await result.current.unsubscribe();
    });

    expect(success).toBe(false);
  });



  it("handles empty padding correctly during base64 conversion", async () => {
    mockPushManager.subscribe.mockResolvedValue({
      toJSON: () => ({
        endpoint: "https://push.example.com",
        keys: { p256dh: "p256dh-key", auth: "auth-key" }
      })
    });
    vi.mocked(apiRequest).mockResolvedValue(true as any);
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ publicKey: "BEl6tAMqBEl6tAMqBEl6tAMqBEl6tAMq" }), // length 32, no padding needed
    });

    const { result } = renderHook(() => usePushNotifications());

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    let success;
    await act(async () => {
      success = await result.current.subscribe();
    });

    expect(success).toBe(true);
  });



  it("handles when navigator is undefined", () => {
    delete (globalThis as any).navigator;

    const { result } = renderHook(() => usePushNotifications());

    expect(result.current.isSupported).toBe(false);
  });

});
