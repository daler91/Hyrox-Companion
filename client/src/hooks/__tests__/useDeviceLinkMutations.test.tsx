import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDeviceLinkMutations } from "../useDeviceLinkMutations";

const apiMocks = vi.hoisted(() => ({
  linkDeviceActivity: vi.fn(),
  unlinkDeviceActivity: vi.fn(),
  dismissDeviceLinkSuggestion: vi.fn(),
}));

const queryClientMocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/api", () => ({
  api: {
    workouts: {
      linkDeviceActivity: apiMocks.linkDeviceActivity,
      unlinkDeviceActivity: apiMocks.unlinkDeviceActivity,
      dismissDeviceLinkSuggestion: apiMocks.dismissDeviceLinkSuggestion,
    },
  },
  QUERY_KEYS: {
    timeline: ["/api/v1/timeline"],
    workouts: ["/api/v1/workouts"],
    plans: ["/api/v1/plans"],
    personalRecords: ["/api/v1/personal-records"],
    exerciseAnalytics: ["/api/v1/exercise-analytics"],
    trainingOverview: ["/api/v1/training-overview"],
  },
}));

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

const DEVICE_LINK_KEYS = [
  ["/api/v1/timeline"],
  ["/api/v1/workouts"],
  ["/api/v1/plans"],
  ["/api/v1/personal-records"],
  ["/api/v1/exercise-analytics"],
  ["/api/v1/training-overview"],
];

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

describe("useDeviceLinkMutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("linkMutation", () => {
    it("links to the given target and invalidates everything the link can move", async () => {
      apiMocks.linkDeviceActivity.mockResolvedValue({ id: "log-1" });
      const { result } = renderHook(() => useDeviceLinkMutations(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.linkMutation.mutateAsync({
          workoutLogId: "log-1",
          target: { planDayId: "day-1" },
          targetLabel: "Tuesday's run",
        });
      });

      expect(apiMocks.linkDeviceActivity).toHaveBeenCalledWith("log-1", { planDayId: "day-1" });
      expect(invalidatedKeys()).toEqual(DEVICE_LINK_KEYS);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Linked to Tuesday's run",
          description: "The Strava recording now sits on that workout.",
        }),
      );
    });

    it("shows an error toast and does not invalidate on failure", async () => {
      apiMocks.linkDeviceActivity.mockRejectedValue(new Error("Not found"));
      const { result } = renderHook(() => useDeviceLinkMutations(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.linkMutation
          .mutateAsync({
            workoutLogId: "log-1",
            target: { workoutLogId: "log-2" },
            targetLabel: "Monday's workout",
          })
          .catch(() => {});
      });

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Couldn't link the Strava activity",
          description: "Not found",
          variant: "destructive",
        }),
      );
      expect(queryClientMocks.invalidateQueries).not.toHaveBeenCalled();
    });
  });

  describe("unlinkMutation", () => {
    it("unlinks and invalidates the same query set, with a fixed success toast", async () => {
      apiMocks.unlinkDeviceActivity.mockResolvedValue({ log: null, standalone: { id: "log-3" } });
      const { result } = renderHook(() => useDeviceLinkMutations(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.unlinkMutation.mutateAsync({ workoutLogId: "log-1" });
      });

      expect(apiMocks.unlinkDeviceActivity).toHaveBeenCalledWith("log-1");
      expect(invalidatedKeys()).toEqual(DEVICE_LINK_KEYS);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Strava activity unlinked",
          description: "It's back on the timeline as its own workout.",
        }),
      );
    });

    it("shows an error toast on unlink failure", async () => {
      apiMocks.unlinkDeviceActivity.mockRejectedValue(new Error("Network error"));
      const { result } = renderHook(() => useDeviceLinkMutations(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.unlinkMutation.mutateAsync({ workoutLogId: "log-1" }).catch(() => {});
      });

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Couldn't unlink the Strava activity",
          description: "Network error",
          variant: "destructive",
        }),
      );
    });
  });

  describe("dismissMutation", () => {
    it("dismisses silently on success: only the timeline is invalidated, no toast", async () => {
      apiMocks.dismissDeviceLinkSuggestion.mockResolvedValue({ id: "log-1" });
      const { result } = renderHook(() => useDeviceLinkMutations(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.dismissMutation.mutateAsync({ workoutLogId: "log-1" });
      });

      expect(apiMocks.dismissDeviceLinkSuggestion).toHaveBeenCalledWith("log-1");
      expect(invalidatedKeys()).toEqual([["/api/v1/timeline"]]);
      expect(mockToast).not.toHaveBeenCalled();
    });

    it("shows an error toast on dismiss failure", async () => {
      apiMocks.dismissDeviceLinkSuggestion.mockRejectedValue(new Error("Gone"));
      const { result } = renderHook(() => useDeviceLinkMutations(), { wrapper: createWrapper() });

      await act(async () => {
        await result.current.dismissMutation.mutateAsync({ workoutLogId: "log-1" }).catch(() => {});
      });

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Couldn't dismiss the suggestion",
          description: "Gone",
          variant: "destructive",
        }),
      );
    });
  });
});
