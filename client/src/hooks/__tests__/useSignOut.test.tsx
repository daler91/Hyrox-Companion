import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSignOut } from "@/hooks/useSignOut";

vi.mock("@clerk/react", () => ({
  useClerk: () => ({ signOut: vi.fn() }),
}));

describe("useSignOut", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("clears user-scoped browser data while preserving device preferences", () => {
    localStorage.setItem("fitai-offline-queue", "[]");
    localStorage.setItem("fitai-log-workout-draft:user-1", "{}");
    localStorage.setItem("fitai-onboarding-complete", "true");
    localStorage.setItem("theme", "dark");
    localStorage.setItem("fitai-privacy-consent-v1", "123");
    sessionStorage.setItem("fitai-log-workout-draft-announced:user-1", "1");

    const { result } = renderHook(() => useSignOut());

    act(() => {
      void result.current();
    });

    expect(localStorage.getItem("fitai-offline-queue")).toBeNull();
    expect(localStorage.getItem("fitai-log-workout-draft:user-1")).toBeNull();
    expect(localStorage.getItem("fitai-onboarding-complete")).toBeNull();
    expect(sessionStorage.getItem("fitai-log-workout-draft-announced:user-1")).toBeNull();
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(localStorage.getItem("fitai-privacy-consent-v1")).toBe("123");
  });
});
