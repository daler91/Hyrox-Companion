import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
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

const ATHLETE_ID = "user-1";

// The signed-in athlete as useAuth caches it; the hook only ever reads it.
let authCache: QueryClient;
function wrapper({ children }: { readonly children: ReactNode }) {
  return <QueryClientProvider client={authCache}>{children}</QueryClientProvider>;
}

describe("useOnboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    globalThis.history.replaceState(null, "", "/");
    authCache = new QueryClient();
    authCache.setQueryData(["/api/v1/auth/user"], { id: ATHLETE_ID });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not mark onboarding complete until an import succeeds", async () => {
    const input = document.createElement("input");
    input.click = vi.fn();
    const fileInputRef = { current: input };
    const { result } = renderHook(() => useOnboarding(false, fileInputRef), { wrapper });

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

    expect(localStorage.getItem("fitai-onboarding-complete")).toBe(ATHLETE_ID);
    expect(api.preferences.update).toHaveBeenCalledWith({ onboardingCompleted: true });
    expect(result.current.pendingImportCompletion).toBe(false);
  });

  // Cancelling the picker used to strand the athlete on an empty Timeline
  // (onboarding audit M1).
  it("reopens the wizard when the athlete cancels the file picker", () => {
    const input = document.createElement("input");
    input.click = vi.fn();
    const { result } = renderHook(
      () => useOnboarding(true, { current: input }, { onboardingCompleted: false }),
      { wrapper },
    );
    expect(result.current.showOnboarding).toBe(true);

    act(() => {
      result.current.handleOnboardingComplete("import");
    });
    expect(result.current.showOnboarding).toBe(false);

    act(() => {
      input.dispatchEvent(new Event("cancel"));
    });
    expect(result.current.showOnboarding).toBe(true);
  });

  it("stays closed once a file is chosen", () => {
    const input = document.createElement("input");
    input.click = vi.fn();
    const { result } = renderHook(
      () => useOnboarding(true, { current: input }, { onboardingCompleted: false }),
      { wrapper },
    );

    act(() => {
      result.current.handleOnboardingComplete("import");
    });
    act(() => {
      input.dispatchEvent(new Event("change"));
      input.dispatchEvent(new Event("cancel"));
    });
    expect(result.current.showOnboarding).toBe(false);
  });

  it("does not show onboarding when durable completion is true", () => {
    const fileInputRef = { current: document.createElement("input") };
    const { result } = renderHook(
      () => useOnboarding(true, fileInputRef, { onboardingCompleted: true }),
      { wrapper },
    );

    expect(result.current.showOnboarding).toBe(false);
    expect(api.preferences.update).not.toHaveBeenCalled();
  });

  it("syncs this athlete's local completion and suppresses onboarding", async () => {
    localStorage.setItem("fitai-onboarding-complete", ATHLETE_ID);
    const fileInputRef = { current: document.createElement("input") };
    const { result } = renderHook(
      () => useOnboarding(true, fileInputRef, { onboardingCompleted: false }),
      { wrapper },
    );

    expect(result.current.showOnboarding).toBe(false);
    await waitFor(() => {
      expect(api.preferences.update).toHaveBeenCalledWith({ onboardingCompleted: true });
    });
  });

  it("waits for auth-user load before syncing local completion", async () => {
    localStorage.setItem("fitai-onboarding-complete", ATHLETE_ID);
    const fileInputRef = { current: document.createElement("input") };
    const { rerender } = renderHook(
      ({ isAuthUserLoaded }: { isAuthUserLoaded: boolean }) =>
        useOnboarding(true, fileInputRef, {
          isAuthUserLoaded,
          onboardingCompleted: false,
        }),
      { initialProps: { isAuthUserLoaded: false }, wrapper },
    );

    expect(api.preferences.update).not.toHaveBeenCalled();

    rerender({ isAuthUserLoaded: true });

    await waitFor(() => {
      expect(api.preferences.update).toHaveBeenCalledWith({ onboardingCompleted: true });
    });
  });

  // The flag was unscoped, so a new account on a device where someone else had
  // finished setup skipped onboarding and was marked complete on the server.
  // CL45 (CODEBASE_ANALYSIS_2026-10-03)
  it.each([
    ["another athlete's", "user-2"],
    ["a legacy unscoped", "true"],
  ])("launches onboarding over %s local flag and syncs nothing", async (_label, stored) => {
    localStorage.setItem("fitai-onboarding-complete", stored);
    const fileInputRef = { current: document.createElement("input") };
    const { result } = renderHook(
      () => useOnboarding(true, fileInputRef, { onboardingCompleted: false }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.showOnboarding).toBe(true);
    });
    expect(api.preferences.update).not.toHaveBeenCalled();
  });

  it("does not trust the local flag before the athlete is known", () => {
    localStorage.setItem("fitai-onboarding-complete", ATHLETE_ID);
    authCache.clear();
    const fileInputRef = { current: document.createElement("input") };
    renderHook(() => useOnboarding(true, fileInputRef, { onboardingCompleted: false }), {
      wrapper,
    });

    expect(api.preferences.update).not.toHaveBeenCalled();
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

    const { result } = renderHook(
      () => useOnboarding(true, fileInputRef, { onboardingCompleted: false }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.showOnboarding).toBe(true);
    });
  });

  // A failed auth-user query has no onboardingCompleted to read. Taking that
  // as false launched the wizard for an onboarded athlete with no plan or log
  // on a device without the local completion flag. U5 (CODEBASE_ANALYSIS_2026-10-03)
  it("does not launch onboarding while the server's completion is unknown", () => {
    const fileInputRef = { current: document.createElement("input") };
    const { result, rerender } = renderHook(
      ({ onboardingCompleted }: { onboardingCompleted: boolean | undefined }) =>
        useOnboarding(true, fileInputRef, { onboardingCompleted }),
      { initialProps: { onboardingCompleted: undefined as boolean | undefined }, wrapper },
    );

    expect(result.current.showOnboarding).toBe(false);

    rerender({ onboardingCompleted: false });
    expect(result.current.showOnboarding).toBe(true);
  });

  it("opens onboarding for the forced URL override even when completion is durable", async () => {
    globalThis.history.replaceState(null, "", "/?onboarding=run");
    const fileInputRef = { current: document.createElement("input") };
    const { result } = renderHook(
      () => useOnboarding(false, fileInputRef, { onboardingCompleted: true }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.showOnboarding).toBe(true);
    });
    expect(globalThis.location.search).toBe("");
  });
});
