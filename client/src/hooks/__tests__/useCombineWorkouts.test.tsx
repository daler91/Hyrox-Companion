import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useCombineWorkouts } from "../useCombineWorkouts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import * as queryClientLib from "@/lib/queryClient";
import * as apiLib from "@/lib/api";
import * as toastHook from "@/hooks/use-toast";
import type { TimelineEntry } from "@shared/schema";

vi.mock("@/lib/api", () => ({
  createWorkout: vi.fn(),
  deleteWorkout: vi.fn(),
  updateDayStatus: vi.fn(),
}));
vi.mock("@/lib/queryClient", () => ({
  queryClient: { invalidateQueries: vi.fn() },

}));
vi.mock("@/hooks/use-toast", () => ({ useToast: vi.fn() }));

function createMockEntry(id: string, date: string, type: "planned" | "completed" = "planned", props: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    id, date, type, status: type,
    focus: "Focus", mainWorkout: "Main", accessory: null, notes: null,
    ...props,
  } as TimelineEntry;
}

describe("useCombineWorkouts", () => {
  let queryClient: QueryClient;
  const mockToast = vi.fn();

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(queryClientLib.queryClient.invalidateQueries).mockClear();
    vi.mocked(toastHook.useToast).mockReturnValue({ toast: mockToast } as unknown as ReturnType<typeof toastHook.useToast>);
    vi.mocked(apiLib.createWorkout).mockResolvedValue({ id: "new" });
  });
  afterEach(() => { vi.clearAllMocks(); });

  const wrapper = ({ children }: { children: React.ReactNode }) => (<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);

  const expectState = (res: Record<string, unknown>, entry1: unknown, entry2: unknown, dialog: boolean) => {
    expect(res.combiningEntry).toEqual(entry1);
    expect(res.combineSecondEntry).toEqual(entry2);
    expect(res.showCombineDialog).toBe(dialog);
  };

  it("handles initial state and reset correctly", () => {
    const { result } = renderHook(() => useCombineWorkouts(), { wrapper });
    expectState(result.current, null, null, false);
  });

  describe("handleCombine selections", () => {
    const entry1 = createMockEntry("e1", "2024-05-01");
    const entryDiffDate = createMockEntry("e2", "2024-05-02");
    const entry2 = createMockEntry("e3", "2024-05-01");

    it.each([
      [entry1, true, null, "Combine cancelled", null, false], // Same entry cancels
      [entryDiffDate, false, null, "Can only combine workouts on the same day", null, false], // Diff date errors
      [entry2, false, entry2, "", entry1, true], // Valid second entry
    ])("combines sequences %s -> expects %s", (testEntry, isSameEntry, expectComb2, expectedToastTitle, expectComb1, expectDialog) => {
      const { result } = renderHook(() => useCombineWorkouts(), { wrapper });

      // Step 1: initial selection. Should set state.
      act(() => { result.current.handleCombine(entry1); });
      expectState(result.current, entry1, null, false);
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Select another workout to combine with" }));
      mockToast.mockClear();

      // Step 2: secondary action (what we are actually testing parameterized)
      act(() => { result.current.handleCombine(testEntry); });

      if (expectedToastTitle) {
        expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: expectedToastTitle }));
      }
      expectState(result.current, expectComb1, expectComb2, expectDialog);
    });
  });

  describe("handleConfirmCombine flows", () => {
    const combinedWorkout = { date: "2024-05-01", focus: "Combined", mainWorkout: "Details", notes: "Notes" };
    const eLog = createMockEntry("e1", "2024-05-01", "planned", { workoutLogId: "log-1" });
    const ePlan = createMockEntry("e2", "2024-05-01", "planned", { planDayId: "plan-1" });

    it("does nothing if combining entries are not set", () => {
      const { result } = renderHook(() => useCombineWorkouts(), { wrapper });
      act(() => { result.current.handleConfirmCombine(combinedWorkout); });
      expect(apiLib.createWorkout).not.toHaveBeenCalled();
      expect(apiLib.deleteWorkout).not.toHaveBeenCalled();
      expect(apiLib.updateDayStatus).not.toHaveBeenCalled();
    });

    it.each([
      [true, "Workouts combined!"],
      [false, "Failed to combine workouts"]
    ])("executes mutation (success: %s)", async (isSuccess, expectedToast) => {
      if (!isSuccess) vi.mocked(apiLib.createWorkout).mockRejectedValueOnce(new Error("API Error"));

      const { result } = renderHook(() => useCombineWorkouts(), { wrapper });
      act(() => {
        result.current.setCombiningEntry(eLog);
        result.current.setCombineSecondEntry(ePlan);
        result.current.setShowCombineDialog(true);
      });

      act(() => { result.current.handleConfirmCombine(combinedWorkout); });

      await waitFor(() => {
        expectState(result.current, null, null, false);
        expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: expectedToast }));
      });

      if (isSuccess) {
        expect(apiLib.createWorkout).toHaveBeenCalledWith(combinedWorkout);
        expect(apiLib.deleteWorkout).toHaveBeenCalledWith("log-1");
        expect(apiLib.updateDayStatus).toHaveBeenCalledWith("plan-1", "skipped");
        expect(queryClientLib.queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
      }
    });
  });
});
