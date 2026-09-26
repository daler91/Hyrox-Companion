import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createWrapper, mockToast } from "@/test/support/mutationHookMocks";

import { useApplyMissedRecovery } from "../useMissedRecovery";

const apiMocks = vi.hoisted(() => ({ applyMissedRecovery: vi.fn() }));

vi.mock("@/lib/api", () => ({
  api: { plans: { applyMissedRecovery: apiMocks.applyMissedRecovery } },
  QUERY_KEYS: {
    timeline: ["/api/v1/timeline"],
    trainingOverview: ["/api/v1/training-overview"],
    plans: ["/api/v1/plans"],
    missedRecovery: (id: string) => ["/api/v1/plans/days", id, "recovery"],
    planDayExercises: (id: string) => ["/api/v1/plans/days", id, "exercises"],
  },
}));
vi.mock("@/lib/queryClient", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined), removeQueries: vi.fn() },
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
});
