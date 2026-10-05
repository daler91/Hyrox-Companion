import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createWrapper,
  invalidatedKeys,
  invalidateQueriesSpy,
} from "@/test/support/mutationHookMocks";

import { useSetTarget } from "../useNutrition";

const setTargetMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  api: { nutrition: { setTarget: setTargetMock } },
  QUERY_KEYS: {
    nutritionTargets: ["/api/v1/nutrition/targets"],
    nutritionDayPrefix: ["/api/v1/nutrition/summary"],
    nutritionRangePrefix: ["/api/v1/nutrition/summary-range"],
    nutritionBlockPrefix: ["/api/v1/nutrition/block"],
  },
}));

vi.mock("@/lib/queryClient", async (importOriginal) =>
  (await import("@/test/support/mutationHookMocks")).makeQueryClientSingletonMock(importOriginal),
);
vi.mock("@/hooks/use-toast", async () =>
  (await import("@/test/support/mutationHookMocks")).makeToastMock(),
);

// CL19 (CODEBASE_ANALYSIS_2026-10-03): saving targets refreshed only the
// targets query, so the day header and the Timeline chips kept the old goal.
describe("useSetTarget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateQueriesSpy.mockImplementation(() => Promise.resolve());
  });

  it("refreshes every read that carries the daily target", async () => {
    setTargetMock.mockResolvedValue({ id: "t1" });
    const { result } = renderHook(() => useSetTarget(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ calories: 2500 });
    });

    expect(invalidatedKeys()).toEqual([
      ["/api/v1/nutrition/targets"],
      ["/api/v1/nutrition/summary"],
      ["/api/v1/nutrition/summary-range"],
      // Analytics -> Fuelling's block points carry each day's carb target.
      ["/api/v1/nutrition/block"],
    ]);
  });
});
