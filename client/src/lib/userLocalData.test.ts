import { beforeEach, describe, expect, it } from "vitest";

import { clearUserLocalData } from "./userLocalData";

describe("clearUserLocalData", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("removes user-scoped local data while preserving device/global preferences", () => {
    localStorage.setItem("fitai-offline-queue", "[]");
    localStorage.setItem("hyrox-offline-queue", "[]");
    localStorage.setItem("fitai-log-workout-draft:user-1", "{}");
    localStorage.setItem("hyrox-log-workout-draft:user-1", "{}");
    localStorage.setItem("fitai-onboarding-complete", "true");
    localStorage.setItem("fitai-settings-style-audit", "[]");
    localStorage.setItem("theme", "dark");
    localStorage.setItem("fitai-privacy-consent-v1", "123");
    sessionStorage.setItem("fitai-log-workout-draft-announced:user-1", "1");
    sessionStorage.setItem("hyrox-log-workout-draft-announced:user-1", "1");

    clearUserLocalData();

    expect(localStorage.getItem("fitai-offline-queue")).toBeNull();
    expect(localStorage.getItem("hyrox-offline-queue")).toBeNull();
    expect(localStorage.getItem("fitai-log-workout-draft:user-1")).toBeNull();
    expect(localStorage.getItem("hyrox-log-workout-draft:user-1")).toBeNull();
    expect(localStorage.getItem("fitai-onboarding-complete")).toBeNull();
    expect(localStorage.getItem("fitai-settings-style-audit")).toBeNull();
    expect(sessionStorage.getItem("fitai-log-workout-draft-announced:user-1")).toBeNull();
    expect(sessionStorage.getItem("hyrox-log-workout-draft-announced:user-1")).toBeNull();
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(localStorage.getItem("fitai-privacy-consent-v1")).toBe("123");
  });
});
