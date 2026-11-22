import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RateLimitError } from "@/lib/queryClient";
import { createWrapper, invalidatedKeys, mockToast } from "@/test/support/mutationHookMocks";

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
    // Read by WORKOUT_ANALYTICS_QUERY_KEYS, which a sync spreads in. D3
    // (REFACTORING_REVIEW 2026-09-23)
    trainingOverview: ["/api/v1/training-overview"],
    sessionGradesPrefix: ["/api/v1/session-grades"],
    // Read by WORKOUT_DERIVED_NUTRITION_QUERY_KEYS, which a sync spreads in.
    // CL19 (CODEBASE_ANALYSIS_2026-10-03)
    nutritionSessionFuellingPrefix: ["/api/v1/nutrition/session-fuelling"],
    nutritionDayPrefix: ["/api/v1/nutrition/summary"],
    nutritionRangePrefix: ["/api/v1/nutrition/summary-range"],
    nutritionBlockPrefix: ["/api/v1/nutrition/block"],
  },
}));

vi.mock("@/hooks/use-toast", async () =>
  (await import("@/test/support/mutationHookMocks")).makeToastMock(),
);

vi.mock("@/lib/queryClient", async (importOriginal) =>
  (await import("@/test/support/mutationHookMocks")).makeQueryClientSingletonMock(importOriginal),
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

    it("shows the server's own copy, not the raw status and JSON body, on failure (U28)", async () => {
      // The shape apiRequest throws: `${status}: ${body}`. The old test threw a
      // plain Error, so printing error.message passed while athletes read JSON.
      apiMocks.connect.mockRejectedValue(
        new Error(
          '401: {"error":"Garmin rejected your email or password. Check them and try again.","code":"GARMIN_AUTH_FAILED"}',
        ),
      );
      await runMutation((m) => m.connectGarminMutation, {
        email: "test@example.com",
        password: "password123",
      });

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Garmin Connection Failed",
          description: "Garmin rejected your email or password. Check them and try again.",
          variant: "destructive",
        })
      );
    });

    it("shows the server's wait when Garmin calls are paused (503)", async () => {
      const message =
        "Garmin temporarily blocked us due to rate limits. Please try again in about 12 minutes.";
      apiMocks.connect.mockRejectedValue(
        new Error(`503: ${JSON.stringify({ error: message, code: "GARMIN_CIRCUIT_OPEN" })}`),
      );
      await runMutation((m) => m.connectGarminMutation, {
        email: "test@example.com",
        password: "password123",
      });

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Garmin Connection Failed", description: message }),
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
          description: "Something went wrong. Please try again.",
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

    // D3 (REFACTORING_REVIEW 2026-09-23): the training summary card stayed
    // stale after a sync until its own query refetched.
    it("refreshes every analytics view built from the workout log", async () => {
      apiMocks.sync.mockResolvedValue({ imported: 1, skipped: 0, total: 1 });
      await runMutation((m) => m.syncGarminMutation);
      expect(invalidatedKeys()).toEqual(
        expect.arrayContaining([
          ["/api/v1/personal-records"],
          ["/api/v1/exercise-analytics"],
          ["/api/v1/training-overview"],
          ["/api/v1/session-grades"],
        ]),
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

    it("never prints a 5xx body on sync failure (U28)", async () => {
      apiMocks.sync.mockRejectedValue(new Error('502: {"error":"upstream garmin-connect TypeError at line 42"}'));
      await runMutation((m) => m.syncGarminMutation);

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Garmin Sync Failed",
          description: "Something went wrong on our end. Please try again in a moment.",
          variant: "destructive",
        })
      );
    });

    // Tech debt #55: the server's waits never reached the athlete. The 503 was
    // masked as "Something went wrong on our end", and the 429 became "wait a
    // moment" though the server says how many minutes.
    it("shows the server's wait when Garmin calls are paused (503), and refetches the status", async () => {
      const message =
        "Garmin temporarily blocked us due to rate limits. Please try again in about 27 minutes.";
      apiMocks.sync.mockRejectedValue(
        new Error(`503: ${JSON.stringify({ error: message, code: "GARMIN_CIRCUIT_OPEN" })}`),
      );
      await runMutation((m) => m.syncGarminMutation);

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Garmin Sync Failed", description: message, variant: "destructive" }),
      );
      expect(invalidatedKeys()).toContainEqual(["/api/v1/garmin/status"]);
    });

    // D11 (REFACTORING_REVIEW 2026-09-23): a rate-limited login keeps the
    // connection and answers 502 with the cooldown the athlete should wait.
    it("shows the server's message for a Garmin API failure (502 GARMIN_API_ERROR)", async () => {
      const message =
        "Garmin temporarily blocked us due to rate limits. Please try again in about 30 minutes.";
      apiMocks.sync.mockRejectedValue(
        new Error(`502: ${JSON.stringify({ error: message, code: "GARMIN_API_ERROR" })}`),
      );
      await runMutation((m) => m.syncGarminMutation);

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Garmin Sync Failed", description: message, variant: "destructive" }),
      );
      expect(invalidatedKeys()).toContainEqual(["/api/v1/garmin/status"]);
    });

    it("shows the server's wait for a sync too soon after the last (429)", async () => {
      apiMocks.sync.mockRejectedValue(
        new RateLimitError(
          JSON.stringify({
            error: "Please wait 4 more minutes before syncing again.",
            code: "GARMIN_SYNC_TOO_SOON",
          }),
          null,
        ),
      );
      await runMutation((m) => m.syncGarminMutation);

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Please wait 4 more minutes before syncing again.",
          variant: "destructive",
        }),
      );
    });

    it("triggers error toast with fallback generic message on failure when not an Error", async () => {
      apiMocks.sync.mockRejectedValue("String error");
      await runMutation((m) => m.syncGarminMutation);

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Garmin Sync Failed",
          description: "Something went wrong. Please try again.",
          variant: "destructive",
        })
      );
    });
  });
});
