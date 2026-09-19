import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { useEmptyRecycleBin, useRestoreRecycleBinItem } from "./useRecycleBin";

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

vi.mock("@/lib/api", () => ({
  api: {
    recycleBin: {
      list: vi.fn(),
      restore: vi.fn(),
      restoreBatch: vi.fn(),
      purge: vi.fn(),
      empty: vi.fn(),
    },
  },
  QUERY_KEYS: {
    recycleBin: ["/api/v1/recycle-bin"],
    timeline: ["/api/v1/timeline"],
    workouts: ["/api/v1/workouts"],
    plans: ["/api/v1/plans"],
    personalRecords: ["/api/v1/personal-records"],
    exerciseAnalytics: ["/api/v1/exercise-analytics"],
    trainingOverview: ["/api/v1/training-overview"],
  },
}));

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("recycle bin mutation hooks", () => {
  let client: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  });

  it("surfaces restore warnings in the success toast", async () => {
    const warning =
      "The plan day this workout belonged to no longer exists, so it was restored as an unplanned workout.";
    vi.mocked(api.recycleBin.restore).mockResolvedValue({
      ok: true,
      entityType: "workout_log",
      entityId: "w1",
      batchId: null,
      warnings: [warning],
    });
    const { result } = renderHook(() => useRestoreRecycleBinItem(), {
      wrapper: wrapperFor(client),
    });

    act(() => {
      result.current.mutate("rb-1");
    });

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith({ title: "Restored", description: warning });
    });
  });

  it("explains a plan-overlap refusal in the retirement flow's words", async () => {
    vi.mocked(api.recycleBin.restore).mockRejectedValue(
      new Error(
        '409: {"error":"\\"Race block\\" already covers these dates. Archive it first to restore this plan.","code":"PLAN_OVERLAP"}',
      ),
    );
    const { result } = renderHook(() => useRestoreRecycleBinItem(), {
      wrapper: wrapperFor(client),
    });

    act(() => {
      result.current.mutate("rb-plan");
    });

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith({
        variant: "destructive",
        title: "Can't restore this plan yet",
        description: "Another plan already covers these dates. Archive that one first.",
      });
    });
  });

  it("passes the server's own message through for a conflict", async () => {
    vi.mocked(api.recycleBin.restore).mockRejectedValue(
      new Error(
        '409: {"error":"This Strava activity has been imported again since the workout was deleted.","code":"RECYCLE_BIN_CONFLICT"}',
      ),
    );
    const { result } = renderHook(() => useRestoreRecycleBinItem(), {
      wrapper: wrapperFor(client),
    });

    act(() => {
      result.current.mutate("rb-1");
    });

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith({
        variant: "destructive",
        title: "Couldn't restore",
        description: "This Strava activity has been imported again since the workout was deleted.",
      });
    });
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
