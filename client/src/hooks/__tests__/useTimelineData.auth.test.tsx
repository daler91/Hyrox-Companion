import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTimelineData } from "../useTimelineData";

const apiMocks = vi.hoisted(() => ({
  getTimeline: vi.fn(),
  listAnnotations: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    timeline: {
      get: apiMocks.getTimeline,
    },
    timelineAnnotations: {
      list: apiMocks.listAnnotations,
    },
  },
  QUERY_KEYS: {
    plans: ["/api/v1/plans"],
    personalRecords: ["/api/v1/personal-records"],
    timeline: ["/api/v1/timeline"],
    timelineAnnotations: ["/api/v1/timeline-annotations"],
  },
}));

function createWrapper(defaultQueryFn: ReturnType<typeof vi.fn>) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: defaultQueryFn,
      },
    },
  });

  return function Wrapper({ children }: Readonly<{ children: React.ReactNode }>) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useTimelineData auth gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getTimeline.mockResolvedValue([]);
    apiMocks.listAnnotations.mockResolvedValue([]);
  });

  it("keeps timeline queries disabled until the app user has loaded", async () => {
    const defaultQueryFn = vi.fn().mockResolvedValue([]);
    const { result, rerender } = renderHook(
      ({ isAuthUserLoaded }) => useTimelineData(null, isAuthUserLoaded),
      {
        initialProps: { isAuthUserLoaded: false },
        wrapper: createWrapper(defaultQueryFn),
      },
    );

    expect(result.current.timelineLoading).toBe(true);
    expect(result.current.isNewUser).toBe(false);
    expect(defaultQueryFn).not.toHaveBeenCalled();
    expect(apiMocks.getTimeline).not.toHaveBeenCalled();
    expect(apiMocks.listAnnotations).not.toHaveBeenCalled();

    rerender({ isAuthUserLoaded: true });

    await waitFor(() => expect(apiMocks.getTimeline).toHaveBeenCalledWith(null));
    await waitFor(() => expect(apiMocks.listAnnotations).toHaveBeenCalledTimes(1));
    expect(defaultQueryFn).toHaveBeenCalled();
  });
});
