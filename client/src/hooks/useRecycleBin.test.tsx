import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

import { useEmptyRecycleBin, useRestoreRecycleBinItem, useUndoDeleteToast } from "./useRecycleBin";

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

vi.mock("@/lib/api", async () =>
  (await import("@/test/support/recycleBinApiMock")).mockRecycleBinApiModule(),
);

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function serverError(status: number, error: string, code: string): Error {
  return new Error(`${status}: ${JSON.stringify({ error, code })}`);
}

const PLAN_DAY_GONE =
  "The plan day this workout belonged to no longer exists, so it was restored as an unplanned workout.";
const REIMPORTED = "This Strava activity has been imported again since the workout was deleted.";

describe("recycle bin mutation hooks", () => {
  let client: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  });

  it.each([
    {
      name: "surfaces restore warnings in the success toast",
      outcome: () =>
        vi.mocked(api.recycleBin.restore).mockResolvedValue({
          ok: true,
          entityType: "workout_log",
          entityId: "w1",
          batchId: null,
          warnings: [PLAN_DAY_GONE],
        }),
      toast: { title: "Restored", description: PLAN_DAY_GONE },
    },
    {
      name: "explains a plan-overlap refusal in the retirement flow's words",
      outcome: () =>
        vi
          .mocked(api.recycleBin.restore)
          .mockRejectedValue(
            serverError(
              409,
              '"Race block" already covers these dates. Archive it first to restore this plan.',
              "PLAN_OVERLAP",
            ),
          ),
      toast: {
        variant: "destructive",
        title: "Can't restore this plan yet",
        description: "Another plan already covers these dates. Archive that one first.",
      },
    },
    {
      name: "passes the server's own message through for a conflict",
      outcome: () =>
        vi
          .mocked(api.recycleBin.restore)
          .mockRejectedValue(serverError(409, REIMPORTED, "RECYCLE_BIN_CONFLICT")),
      toast: { variant: "destructive", title: "Couldn't restore", description: REIMPORTED },
    },
  ])("$name", async ({ outcome, toast }) => {
    outcome();
    const { result } = renderHook(() => useRestoreRecycleBinItem(), {
      wrapper: wrapperFor(client),
    });

    act(() => {
      result.current.mutate("rb-1");
    });

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith(toast);
    });
  });

  // CL19 (CODEBASE_ANALYSIS_2026-10-03): a restored workout or plan day is
  // back in the day's meal targets, session fuelling and the Fuelling views.
  it("refreshes the nutrition reads a restored workout feeds", async () => {
    vi.mocked(api.recycleBin.restore).mockResolvedValue({
      ok: true,
      entityType: "workout_log",
      entityId: "w1",
      batchId: null,
      warnings: [],
    });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    const { result } = renderHook(() => useRestoreRecycleBinItem(), {
      wrapper: wrapperFor(client),
    });

    act(() => {
      result.current.mutate("rb-1");
    });

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalled();
    });
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        ["/api/v1/nutrition/session-fuelling"],
        ["/api/v1/nutrition/summary"],
        ["/api/v1/nutrition/summary-range"],
        ["/api/v1/nutrition/block"],
      ]),
    );
    // CL43 (CODEBASE_ANALYSIS_2026-10-03): its sets count in "Last time" again.
    expect(keys).toContainEqual(["/api/v1/exercises"]);
    invalidate.mockRestore();
  });

  // CL50 (CODEBASE_ANALYSIS_2026-10-03): every delete that lands in the bin
  // shows this toast, and none of them refreshed the bin's list, so an athlete
  // who let the Undo expire could not find the item in Settings for a while.
  it("marks the recycle-bin list stale when a delete announces itself", () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    const { result } = renderHook(() => useUndoDeleteToast(), { wrapper: wrapperFor(client) });

    act(() => {
      result.current({ title: "Workout deleted", target: { itemId: "rb-1" } });
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/v1/recycle-bin"] });
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Workout deleted" }));
    invalidate.mockRestore();
  });

  it("reports how many items emptying the bin removed", async () => {
    vi.mocked(api.recycleBin.empty).mockResolvedValue({ success: true, purgedCount: 3 });
    const { result } = renderHook(() => useEmptyRecycleBin(), { wrapper: wrapperFor(client) });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith({ title: "3 items deleted forever" });
    });
  });
});
