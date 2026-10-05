import type { ExerciseSet } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeExerciseSet } from "@/test/factories/exerciseSetFactory";

import { useExerciseSetsForOwner } from "../useExerciseSetsForOwner";

// A window no caller passes, so the test sees which one the hook fell back to.
// Hoisted so the mock and the assertions read one value.
const { SHARED_WINDOW_MS } = vi.hoisted(() => ({ SHARED_WINDOW_MS: 120 }));

vi.mock("@/components/workout-structure/editSaveDebounce", () => ({
  EDIT_SAVE_DEBOUNCE_MS: SHARED_WINDOW_MS,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useUnitPreferences", () => ({
  useUnitPreferences: () => ({ weightUnit: "kg", distanceUnit: "km" }),
}));

type Snapshot = { exerciseSets: ExerciseSet[] };

function renderWithoutWindow() {
  const sets = [makeExerciseSet({ id: "s1", version: 1 })];
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    () =>
      useExerciseSetsForOwner<Snapshot>({
        ownerId: "log-1",
        mutationKeyFamily: (id) => ["owner-sets", id] as const,
        setsQueryKey: (id) => ["/api/v1/workouts", id] as const,
        patchCachedSets: vi.fn(),
        getSnapshot: () => ({ exerciseSets: sets }),
        restoreSnapshot: vi.fn(),
        updateSetRequest: vi.fn(() =>
          Promise.resolve(makeExerciseSet({ id: "s1", reps: 5, version: 2 })),
        ),
        addSetRequest: vi.fn(),
        deleteSetRequest: vi.fn(),
      }),
    { wrapper },
  );
}

describe("useExerciseSetsForOwner's default save window", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is the shared edit window, not a copy of its value (U3)", () => {
    const { result } = renderWithoutWindow();

    act(() => {
      result.current.patchSetDebounced("s1", { reps: 5 });
      vi.advanceTimersByTime(SHARED_WINDOW_MS - 1);
    });
    expect(result.current.getPendingPatches()).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.getPendingPatches()).toEqual([]);
  });
});
