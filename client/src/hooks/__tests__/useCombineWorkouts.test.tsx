import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useCombineWorkouts } from "../useCombineWorkouts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import * as queryClientLib from "@/lib/queryClient";
import * as toastHook from "@/hooks/use-toast";
import type { TimelineEntry } from "@shared/schema";

// Mock external dependencies
vi.mock("@/lib/queryClient", () => ({
  queryClient: {
    invalidateQueries: vi.fn(),
  },
  apiRequest: vi.fn(),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: vi.fn(),
}));

// Helper to create mock entries
function createMockEntry(overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    id: "test-id-1",
    date: "2024-05-01",
    type: "planned",
    status: "planned",
    focus: "Test Focus",
    mainWorkout: "Test Workout",
    accessory: null,
    notes: null,
    ...overrides,
  } as TimelineEntry;
}

describe("useCombineWorkouts", () => {
  let queryClient: QueryClient;
  const mockToast = vi.fn();

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.mocked(toastHook.useToast).mockReturnValue({ toast: mockToast } as any);

    // Default apiRequest to resolve successfully
    vi.mocked(queryClientLib.apiRequest).mockResolvedValue({
      json: vi.fn().mockResolvedValue({ id: "new-workout-1" }),
    } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it("initializes with default state", () => {
    const { result } = renderHook(() => useCombineWorkouts(), { wrapper });

    expect(result.current.combiningEntry).toBeNull();
    expect(result.current.combineSecondEntry).toBeNull();
    expect(result.current.showCombineDialog).toBe(false);
  });

  describe("handleCombine", () => {
    it("sets combining entry when no entry is currently selected", () => {
      const { result } = renderHook(() => useCombineWorkouts(), { wrapper });
      const entry = createMockEntry({ id: "entry-1" });

      act(() => {
        result.current.handleCombine(entry);
      });

      expect(result.current.combiningEntry).toEqual(entry);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Select another workout to combine with",
        })
      );
    });

    it("cancels combining if the same entry is clicked again", () => {
      const { result } = renderHook(() => useCombineWorkouts(), { wrapper });
      const entry = createMockEntry({ id: "entry-1" });

      // First click
      act(() => {
        result.current.handleCombine(entry);
      });

      // Second click on the same entry
      act(() => {
        result.current.handleCombine(entry);
      });

      expect(result.current.combiningEntry).toBeNull();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Combine cancelled" })
      );
    });

    it("errors if trying to combine workouts from different days", () => {
      const { result } = renderHook(() => useCombineWorkouts(), { wrapper });
      const entry1 = createMockEntry({ id: "entry-1", date: "2024-05-01" });
      const entry2 = createMockEntry({ id: "entry-2", date: "2024-05-02" });

      // First click
      act(() => {
        result.current.handleCombine(entry1);
      });

      // Second click on a different date
      act(() => {
        result.current.handleCombine(entry2);
      });

      expect(result.current.combiningEntry).toBeNull(); // It resets on error
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Can only combine workouts on the same day",
          variant: "destructive",
        })
      );
    });

    it("sets second entry and opens dialog for valid second selection", () => {
      const { result } = renderHook(() => useCombineWorkouts(), { wrapper });
      const entry1 = createMockEntry({ id: "entry-1", date: "2024-05-01" });
      const entry2 = createMockEntry({ id: "entry-2", date: "2024-05-01" });

      act(() => {
        result.current.handleCombine(entry1);
      });

      act(() => {
        result.current.handleCombine(entry2);
      });

      expect(result.current.combineSecondEntry).toEqual(entry2);
      expect(result.current.showCombineDialog).toBe(true);
    });
  });

  describe("handleConfirmCombine", () => {
    it("does nothing if combining entries are not set", () => {
      const { result } = renderHook(() => useCombineWorkouts(), { wrapper });

      act(() => {
        result.current.handleConfirmCombine({
          date: "2024-05-01",
          focus: "Combined",
          mainWorkout: "Combined details",
        });
      });

      expect(queryClientLib.apiRequest).not.toHaveBeenCalled();
    });

    it("successfully combines workouts and handles cleanup for workout logs and plan days", async () => {
      const { result } = renderHook(() => useCombineWorkouts(), { wrapper });

      const entry1 = createMockEntry({ id: "entry-1", date: "2024-05-01", workoutLogId: "log-1" });
      const entry2 = createMockEntry({ id: "entry-2", date: "2024-05-01", planDayId: "plan-1" });

      // Set state to simulate dialog being open with two entries selected
      act(() => {
        result.current.setCombiningEntry(entry1);
        result.current.setCombineSecondEntry(entry2);
        result.current.setShowCombineDialog(true);
      });

      const combinedWorkout = {
        date: "2024-05-01",
        focus: "Combined Focus",
        mainWorkout: "Combined Main",
        notes: "Some notes",
      };

      act(() => {
        result.current.handleConfirmCombine(combinedWorkout);
      });

      await waitFor(() => {
        // Should POST the new combined workout
        expect(queryClientLib.apiRequest).toHaveBeenCalledWith("POST", "/api/workouts", combinedWorkout);

        // Should DELETE the first entry because it has a workoutLogId
        expect(queryClientLib.apiRequest).toHaveBeenCalledWith("DELETE", "/api/workouts/log-1");

        // Should PATCH the second entry because it has a planDayId
        expect(queryClientLib.apiRequest).toHaveBeenCalledWith("PATCH", "/api/plans/days/plan-1/status", { status: "skipped" });

        // Should invalidate queries
        expect(queryClientLib.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/timeline"] });
        expect(queryClientLib.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/workouts"] });

        // Should reset state
        expect(result.current.combiningEntry).toBeNull();
        expect(result.current.combineSecondEntry).toBeNull();
        expect(result.current.showCombineDialog).toBe(false);

        // Should show success toast
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ title: "Workouts combined!" })
        );
      });
    });

    it("handles mutation failure correctly", async () => {
      // Simulate API failure
      vi.mocked(queryClientLib.apiRequest).mockRejectedValueOnce(new Error("API Error"));

      const { result } = renderHook(() => useCombineWorkouts(), { wrapper });

      const entry1 = createMockEntry({ id: "entry-1", date: "2024-05-01", workoutLogId: "log-1" });
      const entry2 = createMockEntry({ id: "entry-2", date: "2024-05-01", workoutLogId: "log-2" });

      act(() => {
        result.current.setCombiningEntry(entry1);
        result.current.setCombineSecondEntry(entry2);
        result.current.setShowCombineDialog(true);
      });

      act(() => {
        result.current.handleConfirmCombine({
          date: "2024-05-01",
          focus: "Combined",
          mainWorkout: "Combined details",
        });
      });

      await waitFor(() => {
        // State should be reset on error
        expect(result.current.combiningEntry).toBeNull();
        expect(result.current.combineSecondEntry).toBeNull();
        expect(result.current.showCombineDialog).toBe(false);

        // Should show error toast
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Failed to combine workouts",
            variant: "destructive"
          })
        );
      });
    });
  });
});
