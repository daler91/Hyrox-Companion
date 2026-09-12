import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createWrapper, mockToast } from "@/test/support/mutationHookMocks";

import { useGarminMutations } from "../useGarminMutations";

const apiMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  sync: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    garmin: {
      connect: apiMocks.connect,
      disconnect: apiMocks.disconnect,
      sync: apiMocks.sync,
    },
  },
  QUERY_KEYS: {
    garminStatus: ["/api/v1/garmin/status"],
    timeline: ["/api/v1/timeline"],
    workouts: ["/api/v1/workouts"],
    personalRecords: ["/api/v1/personal-records"],
    exerciseAnalytics: ["/api/v1/exercise-analytics"],
  },
}));

vi.mock("@/hooks/use-toast", async () =>
  (await import("@/test/support/mutationHookMocks")).makeToastMock(),
);

type GarminMutations = ReturnType<typeof useGarminMutations>;

/** Renders the hook and drives one mutation to settled, swallowing a rejection
 *  the way the UI does (the toast, not a thrown promise, carries the error). */
async function runMutation(
  pick: (mutations: GarminMutations) => { mutateAsync: (variables: never) => Promise<unknown> },
  variables?: unknown,
): Promise<void> {
  const { result } = renderHook(() => useGarminMutations(), { wrapper: createWrapper() });
  await act(async () => {
    await pick(result.current)
      .mutateAsync(variables as never)
      .catch(() => {});
  });
}

describe("useGarminMutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("connectGarminMutation", () => {
    it("calls api.garmin.connect on success and triggers success toast", async () => {
      apiMocks.connect.mockResolvedValue({ success: true, garminDisplayName: "John Doe" });
      await runMutation((m) => m.connectGarminMutation, {
        email: "test@example.com",
        password: "password123",
      });

      expect(apiMocks.connect).toHaveBeenCalledWith("test@example.com", "password123");
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Garmin Connected",
          description: "Your Garmin account has been successfully connected.",
        })
      );
    });

    it("triggers error toast with error message on failure", async () => {
      apiMocks.connect.mockRejectedValue(new Error("Invalid credentials"));
      await runMutation((m) => m.connectGarminMutation, {
        email: "test@example.com",
        password: "password123",
      });

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Garmin Connection Failed",
          description: "Invalid credentials",
          variant: "destructive",
        })
      );
    });

    it("triggers error toast with fallback generic message on failure when not an Error", async () => {
      apiMocks.connect.mockRejectedValue("String error");
      await runMutation((m) => m.connectGarminMutation, {
        email: "test@example.com",
        password: "password123",
      });

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Garmin Connection Failed",
          description: "An error occurred",
          variant: "destructive",
        })
      );
    });
  });

  describe("disconnectGarminMutation", () => {
    it("calls api.garmin.disconnect on success and triggers success toast", async () => {
      apiMocks.disconnect.mockResolvedValue(undefined);
      await runMutation((m) => m.disconnectGarminMutation);

      expect(apiMocks.disconnect).toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Garmin Disconnected",
          description: "Your Garmin account has been disconnected.",
        })
      );
    });

    it("triggers error toast on disconnect failure", async () => {
      apiMocks.disconnect.mockRejectedValue(new Error("Network error"));
      await runMutation((m) => m.disconnectGarminMutation);

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Failed to disconnect Garmin.",
          description: "Network error",
          variant: "destructive",
        })
      );
    });
  });

  describe("syncGarminMutation", () => {
    it("calls api.garmin.sync on success and triggers success toast", async () => {
      apiMocks.sync.mockResolvedValue({ imported: 5, skipped: 2, total: 7 });
      await runMutation((m) => m.syncGarminMutation);

      expect(apiMocks.sync).toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Sync Complete",
          description: "Imported 5 new activities. 2 already existed.",
        })
      );
    });

    it("triggers error toast on sync failure", async () => {
      apiMocks.sync.mockRejectedValue(new Error("Rate limited"));
      await runMutation((m) => m.syncGarminMutation);

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Garmin Sync Failed",
          description: "Rate limited",
          variant: "destructive",
        })
      );
    });

    it("triggers error toast with fallback generic message on failure when not an Error", async () => {
      apiMocks.sync.mockRejectedValue("String error");
      await runMutation((m) => m.syncGarminMutation);

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Garmin Sync Failed",
          description: "An error occurred",
          variant: "destructive",
        })
      );
    });
  });
});
