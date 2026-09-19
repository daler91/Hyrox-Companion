import { beforeEach, describe, expect, it } from "vitest";

import { clearUserLocalData } from "./userLocalData";

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
});
