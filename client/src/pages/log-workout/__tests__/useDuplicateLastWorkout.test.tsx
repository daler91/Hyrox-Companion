import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { useDuplicateLastWorkout } from "../useDuplicateLastWorkout";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      workouts: {
        ...actual.api.workouts,
        latest: vi.fn(),
      },
    },
  };
});

const mockWorkouts = api.workouts as unknown as {
  latest: ReturnType<typeof vi.fn>;
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useDuplicateLastWorkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears a seeded plan day link when duplicating the last workout", async () => {
    mockWorkouts.latest.mockResolvedValue({
      focus: "Last workout",
      notes: "Keep it smooth",
      mainWorkout: "Free text fallback",
      exerciseSets: [],
    });
    const setPlanId = vi.fn();
    const setPlanDayId = vi.fn();
    const setDurationMinutes = vi.fn();

    const { result } = renderHook(
      () =>
        useDuplicateLastWorkout({
          setDate: vi.fn(),
          setRpe: vi.fn(),
          setDurationMinutes,
          setTitle: vi.fn(),
          setNotes: vi.fn(),
          setFreeText: vi.fn(),
          setPlanId,
          setPlanDayId,
          resetEditor: vi.fn(),
          toast: vi.fn(),
        }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.handleDuplicateLast();
    });

    await waitFor(() => {
      expect(setPlanId).toHaveBeenCalledWith(null);
      expect(setPlanDayId).toHaveBeenCalledWith(null);
      expect(setDurationMinutes).toHaveBeenCalledWith("");
    });
  });
});
