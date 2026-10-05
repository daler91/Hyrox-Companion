import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
  type QueryFunction,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTimelineData } from "../useTimelineData";

const apiMocks = vi.hoisted(() => ({
  getTimeline: vi.fn(),
  listAnnotations: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    timeline: { getPage: apiMocks.getTimeline },
    timelineAnnotations: { list: apiMocks.listAnnotations },
  },
  QUERY_KEYS: {
    plans: ["/api/v1/plans"],
    personalRecords: ["/api/v1/personal-records"],
    timeline: ["/api/v1/timeline"],
    timelineAnnotations: ["/api/v1/timeline-annotations"],
  },
}));

const ENTRY = { id: "log-1", date: "2026-05-01", status: "completed", workoutLogId: "log-1" };

/** The default query fn serves plans and personal records. */
function renderTimelineData(plansQueryFn: () => Promise<unknown>) {
  const defaultQueryFn = vi.fn(({ queryKey }: { queryKey: readonly unknown[] }) =>
    queryKey[0] === "/api/v1/plans" ? plansQueryFn() : Promise.resolve({}),
  );
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, queryFn: defaultQueryFn as unknown as QueryFunction },
    },
  });
  return renderHook(() => useTimelineData(null, true), {
    wrapper: ({ children }: Readonly<{ children: React.ReactNode }>) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

/** Read every flag in one callback so the observers track them from the first check. */
async function settled(result: { readonly current: ReturnType<typeof useTimelineData> }) {
  await waitFor(() => {
    expect(result.current.timelineLoading).toBe(false);
    expect(result.current.plansLoading).toBe(false);
    expect(result.current.isRetrying).toBe(false);
  });
}

describe("useTimelineData load failures (U5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getTimeline.mockResolvedValue({ entries: [], nextCursor: null });
    apiMocks.listAnnotations.mockResolvedValue([]);
  });

  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it("reports a failed timeline fetch as an error, not as a new user", async () => {
    apiMocks.getTimeline.mockRejectedValue(new Error("500: Internal Server Error"));
    const { result } = renderTimelineData(() => Promise.resolve([]));

    await settled(result);
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.isNewUser).toBe(false);
    expect(result.current.timelineData).toEqual([]);
  });

  it("reports a failed plans fetch under an empty timeline as an error, not as a new user", async () => {
    const { result } = renderTimelineData(() =>
      Promise.reject(new Error("503: Service Unavailable")),
    );

    await settled(result);
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.isNewUser).toBe(false);
  });

  it("still shows a loaded timeline when only the plans fetch failed", async () => {
    apiMocks.getTimeline.mockResolvedValue({ entries: [ENTRY], nextCursor: null });
    const { result } = renderTimelineData(() =>
      Promise.reject(new Error("503: Service Unavailable")),
    );

    await settled(result);
    await waitFor(() => {
      expect(result.current.timelineData).toHaveLength(1);
    });
    expect(result.current.isError).toBe(false);
  });

  it("keeps the first-run signal for an account that really is empty", async () => {
    const { result } = renderTimelineData(() => Promise.resolve([]));

    await settled(result);
    await waitFor(() => {
      expect(result.current.isNewUser).toBe(true);
    });
    expect(result.current.isError).toBe(false);
  });

  // A retry of a query with no data resets it to pending, so isRefetching is
  // never true while the error shows and the welcome flashed during the
  // retry. The error stays up, marked retrying, until the retry answers.
  it("keeps the error up, marked retrying, while a plans retry runs", async () => {
    let rejectPlans = true;
    let resolvePlans: (plans: unknown[]) => void = () => undefined;
    const { result } = renderTimelineData(() => {
      if (rejectPlans) return Promise.reject(new Error("503: Service Unavailable"));
      return new Promise<unknown[]>((resolve) => {
        resolvePlans = resolve;
      });
    });
    await settled(result);
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    rejectPlans = false;
    act(() => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(result.current.isRetrying).toBe(true);
    });
    expect(result.current.isError).toBe(true);
    expect(result.current.timelineLoading).toBe(false);
    expect(result.current.isNewUser).toBe(false);

    act(() => {
      resolvePlans([{ id: "plan-1" }]);
    });
    await waitFor(() => {
      expect(result.current.isError).toBe(false);
    });
    expect(result.current.isRetrying).toBe(false);
    expect(result.current.isNewUser).toBe(false);
  });

  // TanStack pauses rather than runs a fetch while the browser is offline:
  // the query is pending but not isLoading, which read as a loaded, empty
  // account and showed the welcome card (and launched onboarding).
  it("treats a first fetch paused offline as not loaded, not as a new user", async () => {
    onlineManager.setOnline(false);
    const { result } = renderTimelineData(() => Promise.resolve([]));

    await waitFor(() => {
      expect(result.current.timelineLoading).toBe(true);
    });
    expect(result.current.plansLoading).toBe(true);
    expect(result.current.isNewUser).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(apiMocks.getTimeline).not.toHaveBeenCalled();

    act(() => {
      onlineManager.setOnline(true);
    });
    await waitFor(() => {
      expect(result.current.isNewUser).toBe(true);
    });
    expect(result.current.timelineLoading).toBe(false);
  });

  it("keeps the error up, marked retrying, when a retry waits offline", async () => {
    apiMocks.getTimeline.mockRejectedValueOnce(new Error("500: Internal Server Error"));
    const { result } = renderTimelineData(() => Promise.resolve([]));
    await settled(result);
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    onlineManager.setOnline(false);
    act(() => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(result.current.isRetrying).toBe(true);
    });
    expect(result.current.isError).toBe(true);
    expect(result.current.isNewUser).toBe(false);

    act(() => {
      onlineManager.setOnline(true);
    });
    await waitFor(() => {
      expect(result.current.isError).toBe(false);
    });
    expect(result.current.isNewUser).toBe(true);
  });

  it("refetches the failed timeline on retry and clears the error once it loads", async () => {
    apiMocks.getTimeline.mockRejectedValueOnce(new Error("500: Internal Server Error"));
    apiMocks.getTimeline.mockResolvedValue({ entries: [ENTRY], nextCursor: null });
    const { result } = renderTimelineData(() => Promise.resolve([]));
    await settled(result);
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    act(() => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(false);
    });
    expect(result.current.timelineData).toHaveLength(1);
    expect(apiMocks.getTimeline).toHaveBeenCalledTimes(2);
  });
});
