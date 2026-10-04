import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiRequest } from "./queryClient";
import { clearUserLocalData } from "./userLocalData";

vi.mock("./queryClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./queryClient")>()),
  apiRequest: vi.fn(),
}));

const PUSH_ENDPOINT = "https://fcm.googleapis.com/fcm/send/device-1";

function stubPushSubscription() {
  const unsubscribe = vi.fn(() => Promise.resolve(true));
  const subscription = { endpoint: PUSH_ENDPOINT, unsubscribe };
  vi.stubGlobal("navigator", {
    ...globalThis.navigator,
    serviceWorker: {
      getRegistration: () =>
        Promise.resolve({ pushManager: { getSubscription: () => Promise.resolve(subscription) } }),
    },
  });
  return { unsubscribe };
}

describe("clearUserLocalData", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("removes user-scoped local data while preserving device/global preferences", async () => {
    localStorage.setItem("fitai-offline-queue", "[]");
    localStorage.setItem("hyrox-offline-queue", "[]");
    localStorage.setItem("fitai-log-workout-draft:user-1", "{}");
    localStorage.setItem("hyrox-log-workout-draft:user-1", "{}");
    localStorage.setItem("fitai-onboarding-complete", "true");
    localStorage.setItem("fitai-settings-style-audit", "[]");
    localStorage.setItem("fitai-coach-insights-cache:user-1", "{}");
    localStorage.setItem("fitai-race-prediction-cache:user-1", "{}");
    localStorage.setItem("fitai-overview-analysis-cache:user-1", "{}");
    localStorage.setItem("fitai-maf-tests-cache:user-1", "{}");
    localStorage.setItem("fitai-weekly-review-prompt-dismissed:user-1", "2026-09-14");
    localStorage.setItem("theme", "dark");
    localStorage.setItem("fitai-privacy-consent-v1", "123");
    sessionStorage.setItem("fitai-log-workout-draft-announced:user-1", "1");
    sessionStorage.setItem("hyrox-log-workout-draft-announced:user-1", "1");

    await clearUserLocalData();

    expect(localStorage.getItem("fitai-offline-queue")).toBeNull();
    expect(localStorage.getItem("hyrox-offline-queue")).toBeNull();
    expect(localStorage.getItem("fitai-log-workout-draft:user-1")).toBeNull();
    expect(localStorage.getItem("hyrox-log-workout-draft:user-1")).toBeNull();
    expect(localStorage.getItem("fitai-onboarding-complete")).toBeNull();
    expect(localStorage.getItem("fitai-settings-style-audit")).toBeNull();
    expect(localStorage.getItem("fitai-coach-insights-cache:user-1")).toBeNull();
    expect(localStorage.getItem("fitai-race-prediction-cache:user-1")).toBeNull();
    expect(localStorage.getItem("fitai-overview-analysis-cache:user-1")).toBeNull();
    expect(localStorage.getItem("fitai-maf-tests-cache:user-1")).toBeNull();
    expect(localStorage.getItem("fitai-weekly-review-prompt-dismissed:user-1")).toBeNull();
    expect(sessionStorage.getItem("fitai-log-workout-draft-announced:user-1")).toBeNull();
    expect(sessionStorage.getItem("hyrox-log-workout-draft-announced:user-1")).toBeNull();
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(localStorage.getItem("fitai-privacy-consent-v1")).toBe("123");
  });

  it("purges the Workbox api-cache so personal API bodies do not outlive the session", async () => {
    const deleted: string[] = [];
    const originalCaches = globalThis.caches;
    Object.defineProperty(globalThis, "caches", {
      value: {
        delete: (name: string) => {
          deleted.push(name);
          return Promise.resolve(true);
        },
      },
      configurable: true,
      writable: true,
    });

    await clearUserLocalData();

    expect(deleted).toContain("api-cache");

    if (originalCaches === undefined) {
      Reflect.deleteProperty(globalThis, "caches");
    } else {
      Object.defineProperty(globalThis, "caches", {
        value: originalCaches,
        configurable: true,
        writable: true,
      });
    }
  });

  it("resolves even when Cache Storage is unavailable", async () => {
    await expect(clearUserLocalData()).resolves.toBeUndefined();
  });

  // P3 (CODEBASE_ANALYSIS_2026-10-03): a push subscription belongs to the
  // browser, not the athlete, so without this a shared device kept receiving
  // the signed-out athlete's notifications.
  describe("push subscription", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.mocked(apiRequest).mockReset();
    });

    it("removes the server row while the session is valid, then unsubscribes the browser", async () => {
      const { unsubscribe } = stubPushSubscription();
      vi.mocked(apiRequest).mockResolvedValue(new Response("{}"));

      await clearUserLocalData();

      expect(apiRequest).toHaveBeenCalledWith(
        "DELETE",
        "/api/v1/push/unsubscribe",
        { endpoint: PUSH_ENDPOINT },
        expect.any(AbortSignal),
      );
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(vi.mocked(apiRequest).mock.invocationCallOrder[0]).toBeLessThan(
        unsubscribe.mock.invocationCallOrder[0],
      );
    });

    it("still unsubscribes the browser when the server request fails (e.g. after account deletion)", async () => {
      const { unsubscribe } = stubPushSubscription();
      vi.mocked(apiRequest).mockRejectedValue(new Error("401: Unauthorized"));

      await expect(clearUserLocalData()).resolves.toBeUndefined();

      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it("does nothing when the browser has no push subscription", async () => {
      vi.stubGlobal("navigator", {
        ...globalThis.navigator,
        serviceWorker: { getRegistration: () => Promise.resolve(undefined) },
      });

      await expect(clearUserLocalData()).resolves.toBeUndefined();

      expect(apiRequest).not.toHaveBeenCalled();
    });
  });
});
