import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useOnboarding } from "@/hooks/useOnboarding";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  QUERY_KEYS: {
    authUser: ["/api/v1/auth/user"],
    preferences: ["/api/v1/preferences"],
    plans: ["/api/v1/plans"],
    timeline: ["/api/v1/timeline"],
  },
  api: {
    preferences: { update: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock("@/lib/queryClient", () => ({
  queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) },
}));

describe("useOnboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not mark onboarding complete until an import succeeds", async () => {
    const input = document.createElement("input");
    input.click = vi.fn();
    const fileInputRef = { current: input };
    const { result } = renderHook(() => useOnboarding(false, fileInputRef));

    act(() => {
      result.current.handleOnboardingComplete("import");
    });

    expect(localStorage.getItem("fitai-onboarding-complete")).toBeNull();
    await waitFor(() => {
      expect(result.current.pendingImportCompletion).toBe(true);
    });

    act(() => {
      result.current.handlePlanImported();
    });

    expect(localStorage.getItem("fitai-onboarding-complete")).toBe("true");
    expect(api.preferences.update).toHaveBeenCalledWith({ onboardingCompleted: true });
    expect(result.current.pendingImportCompletion).toBe(false);
  });

  it("does not show onboarding when durable completion is true", () => {
    const fileInputRef = { current: document.createElement("input") };
    const { result } = renderHook(() =>
      useOnboarding(true, fileInputRef, { onboardingCompleted: true }),
    );

    expect(result.current.showOnboarding).toBe(false);
    expect(api.preferences.update).not.toHaveBeenCalled();
  });

  it("syncs legacy local completion and suppresses onboarding", async () => {
    localStorage.setItem("fitai-onboarding-complete", "true");
    const fileInputRef = { current: document.createElement("input") };
    const { result } = renderHook(() =>
      useOnboarding(true, fileInputRef, { onboardingCompleted: false }),
    );

    expect(result.current.showOnboarding).toBe(false);
    await waitFor(() => {
      expect(api.preferences.update).toHaveBeenCalledWith({ onboardingCompleted: true });
    });
  });

  it("waits for auth-user load before syncing legacy local completion", async () => {
    localStorage.setItem("fitai-onboarding-complete", "true");
    const fileInputRef = { current: document.createElement("input") };
    const { rerender } = renderHook(
      ({ isAuthUserLoaded }: { isAuthUserLoaded: boolean }) =>
        useOnboarding(true, fileInputRef, {
          isAuthUserLoaded,
          onboardingCompleted: false,
        }),
      { initialProps: { isAuthUserLoaded: false } },
    );

    expect(api.preferences.update).not.toHaveBeenCalled();

    rerender({ isAuthUserLoaded: true });

    await waitFor(() => {
      expect(api.preferences.update).toHaveBeenCalledWith({ onboardingCompleted: true });
    });
  });

  it("does not throw when localStorage is unavailable", async () => {
    const throwingStorage = {
      getItem: vi.fn(() => {
        throw new DOMException("Denied", "SecurityError");
      }),
      setItem: vi.fn(() => {
        throw new DOMException("Denied", "SecurityError");
      }),
    };
    vi.stubGlobal("localStorage", throwingStorage);
    const fileInputRef = { current: document.createElement("input") };

    const { result } = renderHook(() =>
      useOnboarding(true, fileInputRef, { onboardingCompleted: false }),
    );

    await waitFor(() => {
      expect(result.current.showOnboarding).toBe(true);
    });
  });

  it("opens onboarding for the forced URL override even when completion is durable", async () => {
    window.history.replaceState(null, "", "/?onboarding=run");
    const fileInputRef = { current: document.createElement("input") };
    const { result } = renderHook(() =>
      useOnboarding(false, fileInputRef, { onboardingCompleted: true }),
    );

    await waitFor(() => {
      expect(result.current.showOnboarding).toBe(true);
    });
    expect(window.location.search).toBe("");
  });
});
