import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePlanDayExercises } from "../usePlanDayExercises";

const useQueryMock = vi.fn();
const useApiMutationMock = vi.fn();
const useExerciseSetsForOwnerMock = vi.fn();

const mutationConfigs: Array<Record<string, unknown>> = [];

vi.mock("@tanstack/react-query", () => ({
  useQuery: (cfg: { queryKey: unknown[] }) => useQueryMock(cfg),
}));

vi.mock("@/hooks/useApiMutation", () => ({
  useApiMutation: (cfg: unknown) => useApiMutationMock(cfg),
}));

vi.mock("@/hooks/useExerciseSetsForOwner", () => ({
  useExerciseSetsForOwner: (cfg: unknown) => useExerciseSetsForOwnerMock(cfg),
}));

vi.mock("@/lib/queryClient", () => ({
  queryClient: {
    getQueryData: vi.fn(() => undefined),
    setQueryData: vi.fn(),
  },
}));

vi.mock("@/lib/api", () => ({
  QUERY_KEYS: {
    planDayExercises: (id: string) => ["planDayExercises", id],
    timeline: ["timeline"],
    plans: ["plans"],
  },
  api: {
    plans: {
      getDayExercises: vi.fn(),
      reparseDay: vi.fn(),
      reparseDayFromImage: vi.fn(),
      updateDayExercise: vi.fn(),
      addDayExercise: vi.fn(),
      deleteDayExercise: vi.fn(),
      updateDayWithoutPlan: vi.fn(),
    },
  },
}));

describe("usePlanDayExercises parse state scoping", () => {
  beforeEach(() => {
    mutationConfigs.length = 0;
    useQueryMock.mockImplementation(() => ({ data: [], isLoading: false }));
    useExerciseSetsForOwnerMock.mockReturnValue({
      updateSet: vi.fn(),
      patchSetDebounced: vi.fn(),
      flushPendingSetPatches: vi.fn(),
      getPendingPatches: vi.fn(() => []),
      addSet: { mutate: vi.fn() },
      deleteSet: { mutate: vi.fn() },
      isSaving: false,
      lastSavedAt: null,
      markSaved: vi.fn(),
    });

    useApiMutationMock.mockImplementation((cfg: { onMutate?: (...args: unknown[]) => unknown; onError?: (...args: unknown[]) => void }) => {
      mutationConfigs.push(cfg as unknown as Record<string, unknown>);
      return ({
      mutate: (...args: unknown[]) => {
        const context = cfg.onMutate?.(...args);
        cfg.onError?.(new Error("parse failed"), args[0], context);
      },
      isPending: false,
    });
    });
  });

  it("clears parseFailed when plan day id changes to another empty day", () => {
    const { result, rerender } = renderHook(({ id }) => usePlanDayExercises(id), {
      initialProps: { id: "day-1" as string | null },
    });

    act(() => {
      result.current.reparseFreeText.mutate(undefined);
    });
    expect(result.current.parseFailed).toBe(true);

    act(() => {
      rerender({ id: "day-2" });
    });
    expect(result.current.exerciseSets).toEqual([]);
    expect(result.current.parseFailed).toBe(false);
    expect(result.current.retryParse).toBeNull();
  });

  it("shows upstream-specific toast copy for 502 responses on text reparse", () => {
    renderHook(() => usePlanDayExercises("day-1"));
    const textMutationCfg = mutationConfigs[0] as { errorToast?: (error: unknown) => { title?: string; description?: string } };
    const toast = textMutationCfg.errorToast?.({ status: 502 });
    expect(toast).toEqual({
      title: "AI service temporarily unavailable",
      description: "Please retry in a moment.",
    });
  });

  it("keeps generic parse toast copy for non-upstream failures", () => {
    renderHook(() => usePlanDayExercises("day-1"));
    const textMutationCfg = mutationConfigs[0] as { errorToast?: (error: unknown) => { title?: string; description?: string } };
    const toast = textMutationCfg.errorToast?.({ status: 422, code: "PARSE_WRITE_THROUGH_REQUIRED" });
    expect(toast).toEqual({ title: "Parse failed — try rewording and retry." });
  });

});
