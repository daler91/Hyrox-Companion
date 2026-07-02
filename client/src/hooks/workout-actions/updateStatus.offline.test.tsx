import type { TimelineEntry } from "@shared/schema";
import { QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateDayStatus: vi.fn(),
  enqueueMutation: vi.fn(),
  createOfflineMutationId: vi.fn(() => "queued-id"),
  toast: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      plans: { ...actual.api.plans, updateDayStatus: mocks.updateDayStatus },
    },
  };
});
vi.mock("@/lib/offlineQueue", () => ({
  enqueueMutation: mocks.enqueueMutation,
  createOfflineMutationId: mocks.createOfflineMutationId,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

let queryClient: QueryClient;
vi.mock("@/lib/queryClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queryClient")>()),
  queryClient: {
    cancelQueries: (...args: unknown[]) => queryClient.cancelQueries(...(args as [never])),
    getQueryData: (...args: unknown[]) => queryClient.getQueryData(...(args as [never])),
    setQueryData: (...args: unknown[]) => queryClient.setQueryData(...(args as [never, never])),
    invalidateQueries: (...args: unknown[]) => queryClient.invalidateQueries(...(args as [never])),
  },
}));

import { QueryClientProvider } from "@tanstack/react-query";

import { QUERY_KEYS } from "@/lib/api";

import { useWorkoutActionMutations } from "./useWorkoutActionMutations";

const TIMELINE_KEY = [...QUERY_KEYS.timeline, null];

function plannedEntry(): TimelineEntry {
  return {
    id: "e1",
    date: "2026-05-16",
    type: "planned",
    status: "planned",
    focus: "Legs",
    mainWorkout: "Squats",
    accessory: null,
    notes: null,
    planDayId: "pd-1",
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function setOnline(online: boolean) {
  Object.defineProperty(globalThis.navigator, "onLine", { value: online, configurable: true });
}

describe("updateStatusMutation offline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createOfflineMutationId.mockReturnValue("queued-id");
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    queryClient.setQueryData(TIMELINE_KEY, [plannedEntry()]);
    setOnline(true);
  });

  afterEach(() => setOnline(true));

  it("persists the optimistic status flip when the change is queued offline", async () => {
    setOnline(false);
    const { result } = renderHook(() => useWorkoutActionMutations(null), { wrapper });

    await act(async () => {
      await result.current.updateStatusMutation.mutateAsync({ dayId: "pd-1", status: "skipped" });
    });

    // The optimistic onMutate flipped the entry; the queued (synthetic
    // success) resolution means onError never rolled it back.
    const entries = queryClient.getQueryData<TimelineEntry[]>(TIMELINE_KEY);
    expect(entries?.[0].status).toBe("skipped");
    expect(mocks.enqueueMutation).toHaveBeenCalledWith(
      "PATCH",
      "/api/v1/plans/days/pd-1/status",
      { status: "skipped" },
      { id: "queued-id" },
    );
    expect(mocks.updateDayStatus).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Status change queued" }),
    );
  });

  it("calls the API and keeps the flip when online", async () => {
    mocks.updateDayStatus.mockResolvedValue({ id: "pd-1", status: "skipped" });
    const { result } = renderHook(() => useWorkoutActionMutations(null), { wrapper });

    await act(async () => {
      await result.current.updateStatusMutation.mutateAsync({ dayId: "pd-1", status: "skipped" });
    });

    expect(mocks.updateDayStatus).toHaveBeenCalledOnce();
    expect(mocks.enqueueMutation).not.toHaveBeenCalled();
    const entries = queryClient.getQueryData<TimelineEntry[]>(TIMELINE_KEY);
    expect(entries?.[0].status).toBe("skipped");
  });
});
