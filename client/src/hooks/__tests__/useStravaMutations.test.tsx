import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useStravaMutations } from "../useStravaMutations";

const apiMocks = vi.hoisted(() => ({
  auth: vi.fn(),
  disconnect: vi.fn(),
  sync: vi.fn(),
}));

const queryClientMocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/api", () => ({
  api: {
    strava: {
      auth: apiMocks.auth,
      disconnect: apiMocks.disconnect,
      sync: apiMocks.sync,
    },
  },
  QUERY_KEYS: {
    stravaStatus: ["/api/v1/strava/status"],
    timeline: ["/api/v1/timeline"],
    workouts: ["/api/v1/workouts"],
    personalRecords: ["/api/v1/personal-records"],
    exerciseAnalytics: ["/api/v1/exercise-analytics"],
  },
}));

// The hook reaches the module-level queryClient directly in its onError (a
// revoked connection must refetch /status even though the mutation failed),
// so that singleton is what the invalidation assertions watch.
vi.mock("@/lib/queryClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queryClient")>()),
  queryClient: { invalidateQueries: queryClientMocks.invalidateQueries },
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: vi.fn(() => ({ toast: mockToast })),
}));

function invalidatedKeys(): unknown[] {
  return queryClientMocks.invalidateQueries.mock.calls.map((call) => call[0].queryKey);
}

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: Readonly<{ children: React.ReactNode }>) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
};

describe("useStravaMutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClientMocks.invalidateQueries.mockResolvedValue(undefined);
  });

  describe("connectStravaMutation", () => {
    it("sends the browser to Strava's authorization URL", async () => {
      apiMocks.auth.mockResolvedValue({ authUrl: "https://www.strava.com/oauth/authorize?client_id=1" });
      const location = { href: "http://localhost/settings" };
      const original = globalThis.location;
      Object.defineProperty(globalThis, "location", { configurable: true, value: location });
      try {
        const { result } = renderHook(() => useStravaMutations(), { wrapper: createWrapper() });
        await act(async () => {
          await result.current.connectStravaMutation.mutateAsync();
        });
        expect(location.href).toBe("https://www.strava.com/oauth/authorize?client_id=1");
      } finally {
        Object.defineProperty(globalThis, "location", { configurable: true, value: original });
      }
    });

    it("toasts when the authorization URL cannot be fetched", async () => {
      apiMocks.auth.mockRejectedValue(new Error("500: boom"));
      const { result } = renderHook(() => useStravaMutations(), { wrapper: createWrapper() });
      await act(async () => {
        await result.current.connectStravaMutation.mutateAsync().catch(() => {});
      });
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Failed to initiate Strava connection.", variant: "destructive" }),
      );
    });
  });

  describe("disconnectStravaMutation", () => {
    it("invalidates the connection status and confirms", async () => {
      apiMocks.disconnect.mockResolvedValue({ success: true });
      const { result } = renderHook(() => useStravaMutations(), { wrapper: createWrapper() });
      await act(async () => {
        await result.current.disconnectStravaMutation.mutateAsync();
      });
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Strava Disconnected" }),
      );
    });
  });

  describe("syncStravaMutation", () => {
    it("reports the import counts and hints at a further sync when more remain", async () => {
      apiMocks.sync.mockResolvedValue({ imported: 3, skipped: 2, hasMore: true });
      const { result } = renderHook(() => useStravaMutations(), { wrapper: createWrapper() });
      await act(async () => {
        await result.current.syncStravaMutation.mutateAsync();
      });
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Sync Complete",
          description: "Imported 3 new activities. 2 already existed. More activities are available — run Sync again.",
        }),
      );
    });

    it("omits the run-again hint when the sync drained the backlog", async () => {
      apiMocks.sync.mockResolvedValue({ imported: 1, skipped: 0, hasMore: false });
      const { result } = renderHook(() => useStravaMutations(), { wrapper: createWrapper() });
      await act(async () => {
        await result.current.syncStravaMutation.mutateAsync();
      });
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ description: "Imported 1 new activities. 0 already existed." }),
      );
    });

    it("asks for a reconnect and refetches /status when the server reports a revoked token", async () => {
      apiMocks.sync.mockRejectedValue(new Error('401: {"error":"Strava access revoked","code":"STRAVA_REAUTH_REQUIRED"}'));
      const { result } = renderHook(() => useStravaMutations(), { wrapper: createWrapper() });
      await act(async () => {
        await result.current.syncStravaMutation.mutateAsync().catch(() => {});
      });
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Strava reconnection needed",
          description: "Strava access was revoked. Please reconnect your account.",
          variant: "destructive",
        }),
      );
      expect(invalidatedKeys()).toContainEqual(["/api/v1/strava/status"]);
    });

    it("humanises any other sync failure and still refetches /status", async () => {
      apiMocks.sync.mockRejectedValue(new Error("502: Strava is down"));
      const { result } = renderHook(() => useStravaMutations(), { wrapper: createWrapper() });
      await act(async () => {
        await result.current.syncStravaMutation.mutateAsync().catch(() => {});
      });
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Failed to sync activities from Strava.", variant: "destructive" }),
      );
      expect(invalidatedKeys()).toContainEqual(["/api/v1/strava/status"]);
    });
  });
});
