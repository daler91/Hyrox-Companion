import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createWrapper, mockToast } from "@/test/support/mutationHookMocks";

import { isStaleRecoveryError, useApplyMissedRecovery } from "../useMissedRecovery";

const apiMocks = vi.hoisted(() => ({ applyMissedRecovery: vi.fn() }));

vi.mock("@/lib/api", () => ({
  api: { plans: { applyMissedRecovery: apiMocks.applyMissedRecovery } },
  QUERY_KEYS: {
    timeline: ["/api/v1/timeline"],
    trainingOverview: ["/api/v1/training-overview"],
    plans: ["/api/v1/plans"],
    missedRecovery: (id: string) => ["/api/v1/plans/days", id, "recovery"],
    planDayExercises: (id: string) => ["/api/v1/plans/days", id, "exercises"],
    nutritionDayPrefix: ["/api/v1/nutrition/summary"],
  },
}));
const queryClientMocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn().mockResolvedValue(undefined),
  removeQueries: vi.fn(),
}));

vi.mock("@/lib/queryClient", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  queryClient: queryClientMocks,
}));
vi.mock("@/hooks/use-toast", async () => (await import("@/test/support/mutationHookMocks")).makeToastMock());

async function reopen(undoing?: { recovery: "folded" | "shortened"; missedOn: string | null }) {
  const { result } = renderHook(() => useApplyMissedRecovery(), { wrapper: createWrapper() });
  await act(async () => {
    await result.current.mutateAsync({ planDayId: "pd-1", body: { action: "reopen" }, undoing });
  });
}

describe("useApplyMissedRecovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.applyMissedRecovery.mockResolvedValue({ day: { id: "pd-1" } });
  });

  it("says where an undone move put the session, and that the full session is back", async () => {
    await reopen({ recovery: "shortened", missedOn: "2026-09-22" });
    expect(mockToast).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Full session back on Tue 22 Sep — decide again" }),
    );

    await reopen({ recovery: "folded", missedOn: "2026-09-22" });
    expect(mockToast).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Moved back to Tue 22 Sep — decide again" }));
  });

  it("reopens a let-go where it is", async () => {
    await reopen();
    expect(mockToast).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Back on your list to decide" }));
  });

  // CL19 (CODEBASE_ANALYSIS_2026-10-03): the day summary falls back to the
  // planned session a recovery folds, shortens or moves.
  it("refreshes the day summaries", async () => {
    await reopen();
    expect(queryClientMocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["/api/v1/nutrition/summary"],
    });
  });
});

// CL34 (CODEBASE_ANALYSIS_2026-10-03): the status is read by the shared
// parseApiError, not a private prefix check.
describe("isStaleRecoveryError", () => {
  it("reads apiRequest's 404 and 409 as an out-of-date card", () => {
    expect(isStaleRecoveryError(new Error('409: {"error":"Not missed","code":"CONFLICT"}'))).toBe(true);
    expect(isStaleRecoveryError(new Error("404: Not Found"))).toBe(true);
  });

  it("leaves every other failure open to a retry", () => {
    expect(isStaleRecoveryError(new Error("500: Internal Server Error"))).toBe(false);
    expect(isStaleRecoveryError(new Error("Plan day 409 failed"))).toBe(false);
    expect(isStaleRecoveryError("409: Conflict")).toBe(false);
    expect(isStaleRecoveryError(new TypeError("Failed to fetch"))).toBe(false);
  });
});
