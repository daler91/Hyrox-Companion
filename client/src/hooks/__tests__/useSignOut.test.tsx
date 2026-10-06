import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useConfirmedSignOut, useSignOut } from "@/hooks/useSignOut";
import { clearOfflineQueue, enqueueMutation, getPendingCount } from "@/lib/offlineQueue";

vi.mock("@clerk/react", () => ({
  useClerk: () => ({ signOut: vi.fn() }),
}));

/** Signed out: sign-out clears the athlete's data from this device, under Clerk or not. */
const SIGNED_IN_MARKER = "fitai-onboarding-complete";
const signedOut = () => localStorage.getItem(SIGNED_IN_MARKER) === null;

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
      result.current();
    });

    expect(localStorage.getItem("fitai-offline-queue")).toBeNull();
    expect(localStorage.getItem("fitai-log-workout-draft:user-1")).toBeNull();
    expect(localStorage.getItem("fitai-onboarding-complete")).toBeNull();
    expect(sessionStorage.getItem("fitai-log-workout-draft-announced:user-1")).toBeNull();
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(localStorage.getItem("fitai-privacy-consent-v1")).toBe("123");
  });
});

// CL61 (CODEBASE_ANALYSIS_2026-10-03): signing out cleared queued offline
// writes with no confirmation and no drop toast.
describe("useConfirmedSignOut", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem(SIGNED_IN_MARKER, "true");
  });

  afterEach(() => {
    clearOfflineQueue();
  });

  function queueTwoWrites() {
    enqueueMutation("POST", "/api/v1/workouts", { title: "Basement gym" }, { id: "first" });
    enqueueMutation("PATCH", "/api/v1/workouts/w1", { notes: "Felt strong" }, { id: "second" });
  }

  it("signs out straight away when nothing is waiting to sync", async () => {
    const { result } = renderHook(() => useConfirmedSignOut());

    await act(() => result.current.requestSignOut());

    expect(result.current.confirmingSignOut).toBe(false);
    expect(signedOut()).toBe(true);
  });

  it("asks first while offline writes are queued, and keeps them when the athlete stays", async () => {
    queueTwoWrites();
    const { result } = renderHook(() => useConfirmedSignOut());

    await act(() => result.current.requestSignOut());

    expect(result.current.confirmingSignOut).toBe(true);
    expect(result.current.pendingWrites).toBe(2);
    expect(signedOut()).toBe(false);
    expect(getPendingCount()).toBe(2);

    act(() => {
      result.current.cancelSignOut();
    });

    expect(result.current.confirmingSignOut).toBe(false);
    expect(signedOut()).toBe(false);
    expect(getPendingCount()).toBe(2);
  });

  it("clears the queued writes and signs out once the athlete confirms", async () => {
    queueTwoWrites();
    const { result } = renderHook(() => useConfirmedSignOut());
    await act(() => result.current.requestSignOut());

    await act(() => result.current.confirmSignOut());

    expect(result.current.confirmingSignOut).toBe(false);
    expect(getPendingCount()).toBe(0);
    expect(signedOut()).toBe(true);
  });
});
