import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useIsAuthUserLoaded } from "../useAuth";
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
    authUser: ["/api/v1/auth/user"],
    plans: ["/api/v1/plans"],
    personalRecords: ["/api/v1/personal-records"],
    timeline: ["/api/v1/timeline"],
    timelineAnnotations: ["/api/v1/timeline-annotations"],
  },
}));

vi.mock("@clerk/react", () => ({
  useAuth: vi.fn(),
  useUser: vi.fn(),
}));

vi.mock("@/lib/queryClient", () => ({
  resetCsrfToken: vi.fn(),
}));

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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

function useAuthGatedTimelineData() {
  const isAuthUserLoaded = useIsAuthUserLoaded();
  return useTimelineData(null, isAuthUserLoaded);
}

describe("useTimelineData auth gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getTimeline.mockResolvedValue([]);
    apiMocks.listAnnotations.mockResolvedValue([]);
  });

  it("keeps timeline queries disabled until the auth-user gate opens", async () => {
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

  it("opens timeline queries after an auth-user error settles", async () => {
    const authUserRequest = createDeferred<never>();
    const defaultQueryFn = vi.fn(({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[0] === "/api/v1/auth/user") {
        return authUserRequest.promise;
      }
      return Promise.resolve([]);
    });

    const { result } = renderHook(() => useAuthGatedTimelineData(), {
      wrapper: createWrapper(defaultQueryFn),
    });

    expect(result.current.timelineLoading).toBe(true);
    expect(apiMocks.getTimeline).not.toHaveBeenCalled();
    expect(apiMocks.listAnnotations).not.toHaveBeenCalled();

    await act(async () => {
      authUserRequest.reject(new Error("auth user unavailable"));
    });

    await waitFor(() => expect(apiMocks.getTimeline).toHaveBeenCalledWith(null));
    await waitFor(() => expect(apiMocks.listAnnotations).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.timelineLoading).toBe(false));
  });
});
