import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdhocLogSheet } from "../AdhocLogSheet";

const { setLocationMock, createWorkoutMock, invalidateQueriesMock } = vi.hoisted(() => ({
  setLocationMock: vi.fn(),
  createWorkoutMock: vi.fn(),
  invalidateQueriesMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/", setLocationMock] as const,
}));

vi.mock("@tanstack/react-query", () => {
  type Opts<T, V = void> = {
    mutationFn: (vars: V) => Promise<T> | T;
    onSuccess?: (data: T) => void;
    onError?: (err: unknown) => void;
  };
  return {
    useMutation: <T, V>(opts: Opts<T, V>) => {
      let isPending = false;
      return {
        get isPending() {
          return isPending;
        },
        mutate: async (vars: V) => {
          isPending = true;
          try {
            const result = await opts.mutationFn(vars);
            opts.onSuccess?.(result);
          } catch (err) {
            opts.onError?.(err);
          } finally {
            isPending = false;
          }
        },
      };
    },
  };
});

vi.mock("@/lib/api", () => ({
  api: {
    workouts: {
      create: (payload: unknown) => createWorkoutMock(payload),
    },
    exercises: {
      parse: vi.fn(),
      parseFromImage: vi.fn(),
    },
  },
  QUERY_KEYS: {
    workouts: ["workouts"],
    timeline: ["timeline"],
    authUser: ["authUser"],
    personalRecords: ["personalRecords"],
    exerciseAnalytics: ["exerciseAnalytics"],
    trainingOverview: ["trainingOverview"],
  },
}));

vi.mock("@/lib/queryClient", () => ({
  queryClient: { invalidateQueries: invalidateQueriesMock },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/useUnitPreferences", () => ({
  useUnitPreferences: () => ({ weightUnit: "kg", distanceUnit: "m" }),
}));

vi.mock("@/components/ui/responsive-sheet", () => ({
  ResponsiveSheet: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div data-testid="responsive-sheet">{children}</div> : null,
}));

vi.mock("@/components/RpeSelector", () => ({
  RpeSelector: () => <div data-testid="rpe-selector" />,
}));

interface MockExerciseTableProps {
  readonly onAddSet: (data: { exerciseName: string; category: string }) => void;
}

vi.mock("../ExerciseTable", () => ({
  ExerciseTable: ({ onAddSet }: MockExerciseTableProps) => (
    <button
      type="button"
      data-testid="mock-add-set"
      onClick={() => onAddSet({ exerciseName: "back_squat", category: "strength" })}
    >
      Add set
    </button>
  ),
}));

vi.mock("../shared/PrescriptionEditor", () => ({
  PrescriptionEditor: () => <div data-testid="prescription-editor" />,
}));

afterEach(() => {
  setLocationMock.mockReset();
  createWorkoutMock.mockReset();
  invalidateQueriesMock.mockClear();
});

describe("AdhocLogSheet", () => {
  it("disables save until the user adds at least one set or some text", () => {
    render(<AdhocLogSheet open onClose={vi.fn()} />);
    expect(screen.getByTestId("adhoc-save-workout")).toBeDisabled();
  });

  it("saves a manually-added set via api.workouts.create and closes", async () => {
    createWorkoutMock.mockResolvedValueOnce({ id: "wk-1" });
    const onClose = vi.fn();
    render(<AdhocLogSheet open onClose={onClose} />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId("mock-add-set"));
    await user.clear(screen.getByTestId("adhoc-duration-minutes-input"));
    await user.type(screen.getByTestId("adhoc-duration-minutes-input"), "47");

    expect(screen.getByTestId("adhoc-save-workout")).toBeEnabled();
    await user.click(screen.getByTestId("adhoc-save-workout"));

    await waitFor(() => expect(createWorkoutMock).toHaveBeenCalledTimes(1));
    const payload = createWorkoutMock.mock.calls[0][0] as {
      title: string;
      focus: string;
      duration?: number;
      exercises?: Array<{ exerciseName: string; sets: unknown[] }>;
    };
    expect(payload.title).toBe("Workout");
    expect(payload.focus).toBe("Workout");
    expect(payload.duration).toBe(47);
    expect(payload.exercises).toBeDefined();
    expect(payload.exercises?.[0]?.exerciseName).toBe("back_squat");
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("routes to /log when the user taps Open full editor", async () => {
    const onClose = vi.fn();
    render(<AdhocLogSheet open onClose={onClose} />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId("adhoc-open-full-editor"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(setLocationMock).toHaveBeenCalledWith("/log");
  });
});
