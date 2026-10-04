import type { ExerciseSet } from "@shared/schema";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QUERY_KEYS } from "@/lib/api";
import type { ReparseResponse } from "@/lib/api/constants";
import { queryClient as appQueryClient } from "@/lib/queryClient";
import { makeExerciseSet } from "@/test/factories/exerciseSetFactory";

import { usePlanDayExercises } from "../usePlanDayExercises";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  getDayExercises: vi.fn<(dayId: string) => Promise<{ exerciseSets: ExerciseSet[]; structureBlocks: [] }>>(),
  reparseDay: vi.fn<(dayId: string) => Promise<ReparseResponse>>(),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/hooks/useUnitPreferences", () => ({
  useUnitPreferences: () => ({ weightUnit: "kg", distanceUnit: "km" }),
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      plans: { ...actual.api.plans, getDayExercises: mocks.getDayExercises, reparseDay: mocks.reparseDay },
    },
  };
});

const DAY_ID = "day-1";
const preParseRow = makeExerciseSet({ id: "set-before-parse", exerciseName: "back_squat" });
const parsedRow = makeExerciseSet({ id: "set-after-parse", exerciseName: "deadlift" });

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={appQueryClient}>{children}</QueryClientProvider>;
}

describe("usePlanDayExercises reparse after the sheet closes (CL21)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appQueryClient.clear();
    mocks.getDayExercises.mockResolvedValueOnce({ exerciseSets: [preParseRow], structureBlocks: [] });
    mocks.getDayExercises.mockResolvedValue({ exerciseSets: [parsedRow], structureBlocks: [] });
  });

  let finishParse: (value: ReparseResponse) => void = () => undefined;

  /** Opens the sheet on DAY_ID and starts a text parse that stays in flight. */
  async function startParseOnOpenSheet() {
    mocks.reparseDay.mockReturnValue(
      new Promise<ReparseResponse>((resolve) => {
        finishParse = resolve;
      }),
    );
    const initialProps: { id: string | null } = { id: DAY_ID };
    const hook = renderHook(({ id }) => usePlanDayExercises(id), { initialProps, wrapper });
    await waitFor(() => {
      expect(hook.result.current.exerciseSets.map((set) => set.id)).toEqual(["set-before-parse"]);
    });

    act(() => {
      hook.result.current.reparseFreeText.mutate(undefined);
    });
    await waitFor(() => {
      expect(mocks.reparseDay).toHaveBeenCalledWith(DAY_ID, undefined);
    });
    return hook;
  }

  it("refetches the parsed rows when the sheet reopens on the day it parsed", async () => {
    const { result, rerender } = await startParseOnOpenSheet();

    // The athlete closes LogSheet while the AI parse is still running.
    rerender({ id: null });
    await act(async () => {
      finishParse({ exercises: [{}], saved: true, setCount: 1 });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(appQueryClient.getQueryState(QUERY_KEYS.planDayExercises(DAY_ID))?.isInvalidated).toBe(true);
    });

    // Reopening inside the staleTime must show the parsed rows, not the
    // replaced ones whose set ids no longer exist.
    rerender({ id: DAY_ID });
    await waitFor(() => {
      expect(result.current.exerciseSets.map((set) => set.id)).toEqual(["set-after-parse"]);
    });
  });

  it("still shows the parse running when the sheet reopens before it finishes", async () => {
    const { result, rerender } = await startParseOnOpenSheet();

    rerender({ id: null });
    rerender({ id: DAY_ID });
    expect(result.current.reparseFreeText.isPending).toBe(true);

    await act(async () => {
      finishParse({ exercises: [{}], saved: true, setCount: 1 });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.exerciseSets.map((set) => set.id)).toEqual(["set-after-parse"]);
    });
  });

  it("does not show another day's parse as running, and still refreshes the day that parsed", async () => {
    const { result, rerender } = await startParseOnOpenSheet();

    rerender({ id: "day-2" });
    expect(result.current.reparseFreeText.isPending).toBe(false);

    await act(async () => {
      finishParse({ exercises: [{}], saved: true, setCount: 1 });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(appQueryClient.getQueryState(QUERY_KEYS.planDayExercises(DAY_ID))?.isInvalidated).toBe(true);
    });
  });
});
