import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadLogWorkoutDraft, saveLogWorkoutDraft } from "@/hooks/useLogWorkoutDraft";

import { AdhocLogSheet } from "../AdhocLogSheet";

const { setLocationMock, createWorkoutMock, invalidateQueriesMock, toastMock } = vi.hoisted(() => ({
  setLocationMock: vi.fn(),
  createWorkoutMock: vi.fn(),
  invalidateQueriesMock: vi.fn().mockResolvedValue(undefined),
  toastMock: vi.fn(),
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
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/hooks/useUnitPreferences", () => ({
  useUnitPreferences: () => ({ weightUnit: "kg", distanceUnit: "m" }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

interface MockResponsiveSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly beforeDismiss?: () => boolean;
  readonly children: ReactNode;
}

vi.mock("@/components/ui/responsive-sheet", () => ({
  // "Dismiss" stands in for a swipe, outside tap or Escape: like the real
  // sheet, it closes only when beforeDismiss doesn't veto it.
  ResponsiveSheet: ({ open, onOpenChange, beforeDismiss, children }: MockResponsiveSheetProps) =>
    open ? (
      <div data-testid="responsive-sheet">
        <button
          type="button"
          data-testid="mock-dismiss-sheet"
          onClick={() => {
            if (beforeDismiss?.() !== false) onOpenChange(false);
          }}
        >
          Dismiss
        </button>
        {children}
      </div>
    ) : null,
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

interface MockPrescriptionEditorProps {
  readonly onDraftFieldChange?: (field: "mainWorkout", value: string) => void;
}

vi.mock("../shared/PrescriptionEditor", () => ({
  // Reports keystrokes only: the real textarea's onSaveField is debounced, so
  // a dismissal straight after typing has seen nothing else yet.
  PrescriptionEditor: ({ onDraftFieldChange }: MockPrescriptionEditorProps) => (
    <textarea
      aria-label="Coach text"
      data-testid="prescription-editor"
      onChange={(e) => onDraftFieldChange?.("mainWorkout", e.target.value)}
    />
  ),
}));

afterEach(() => {
  setLocationMock.mockReset();
  createWorkoutMock.mockReset();
  invalidateQueriesMock.mockClear();
  toastMock.mockReset();
  localStorage.clear();
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

  it("shows PR celebrations after an ad-hoc workout save", async () => {
    createWorkoutMock.mockResolvedValueOnce({
      id: "wk-1",
      newPersonalRecords: [
        {
          exerciseKey: "back_squat",
          exerciseName: "back_squat",
          customLabel: null,
          category: "strength",
          metric: "maxWeight",
          metricLabel: "Max weight",
          value: 105,
          previousValue: 100,
          date: "2026-05-20",
          workoutLogId: "wk-1",
        },
      ],
    });
    render(<AdhocLogSheet open onClose={vi.fn()} />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId("mock-add-set"));
    await user.click(screen.getByTestId("adhoc-save-workout"));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith({
        title: "New PR",
        description: "Back Squat: Max weight 105",
      });
    });
  });

  it("routes to /log when the user taps Open full editor", async () => {
    const onClose = vi.fn();
    render(<AdhocLogSheet open onClose={onClose} />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId("adhoc-open-full-editor"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(setLocationMock).toHaveBeenCalledWith("/log");
  });

  // U2 (CODEBASE_ANALYSIS_2026-10-03): the sheet keeps no draft, so a stray
  // dismissal or the full-editor hop used to throw the entered workout away.
  describe("unsaved input (U2)", () => {
    it("closes straight away when nothing was entered", async () => {
      const onClose = vi.fn();
      render(<AdhocLogSheet open onClose={onClose} />);

      await userEvent.setup().click(screen.getByTestId("mock-dismiss-sheet"));

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("Discard this workout?")).not.toBeInTheDocument();
    });

    it("asks before discarding an entered workout, and Keep editing keeps it", async () => {
      const onClose = vi.fn();
      render(<AdhocLogSheet open onClose={onClose} />);

      const user = userEvent.setup();
      await user.click(screen.getByTestId("mock-add-set"));
      await user.click(screen.getByTestId("mock-dismiss-sheet"));

      expect(await screen.findByText("Discard this workout?")).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();

      await user.click(screen.getByTestId("adhoc-keep-editing"));

      await waitFor(() =>
        expect(screen.queryByText("Discard this workout?")).not.toBeInTheDocument(),
      );
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByTestId("adhoc-save-workout")).toBeEnabled();
    });

    it("discards and closes once the athlete confirms", async () => {
      const onClose = vi.fn();
      render(<AdhocLogSheet open onClose={onClose} />);

      const user = userEvent.setup();
      await user.click(screen.getByTestId("mock-add-set"));
      await user.click(screen.getByTestId("mock-dismiss-sheet"));
      await user.click(await screen.findByTestId("adhoc-discard-workout"));

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("asks even when typed coach text has not reached the debounced save yet", async () => {
      const onClose = vi.fn();
      render(<AdhocLogSheet open onClose={onClose} />);

      const user = userEvent.setup();
      await user.type(screen.getByTestId("prescription-editor"), "5x5 back squat");
      await user.click(screen.getByTestId("mock-dismiss-sheet"));

      expect(await screen.findByText("Discard this workout?")).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    });

    it("carries the entered workout to /log through its draft", async () => {
      const onClose = vi.fn();
      render(<AdhocLogSheet open onClose={onClose} />);

      const user = userEvent.setup();
      await user.type(screen.getByTestId("adhoc-title-input"), "Leg day");
      await user.type(screen.getByTestId("prescription-editor"), "5x5 back squat");
      await user.click(screen.getByTestId("mock-add-set"));
      await user.click(screen.getByTestId("adhoc-open-full-editor"));

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(setLocationMock).toHaveBeenCalledWith("/log");
      // The draft /log hydrates from on mount, under the same user key.
      const draft = loadLogWorkoutDraft("user-1");
      expect(draft).toMatchObject({
        title: "Leg day",
        freeText: "5x5 back squat",
        exerciseBlocks: ["back_squat__1"],
        step: 1,
      });
      expect(draft?.exerciseData["back_squat__1"]).toMatchObject({
        exerciseName: "back_squat",
        category: "strength",
      });
    });

    it("leaves an existing /log draft alone when nothing was entered", async () => {
      saveLogWorkoutDraft("user-1", {
        title: "Earlier draft",
        date: "2026-10-01",
        freeText: "10k easy run",
        notes: "",
        rpe: null,
        timeOfDayMin: null,
        durationMinutes: "",
        distance: "",
        avgHeartrate: "",
        maxHeartrate: "",
        useTextMode: true,
        exerciseBlocks: [],
        exerciseData: {},
        structureBlocks: [],
        blockCounter: 0,
        step: 1,
      });
      render(<AdhocLogSheet open onClose={vi.fn()} />);

      await userEvent.setup().click(screen.getByTestId("adhoc-open-full-editor"));

      expect(setLocationMock).toHaveBeenCalledWith("/log");
      expect(loadLogWorkoutDraft("user-1")).toMatchObject({
        title: "Earlier draft",
        freeText: "10k easy run",
      });
    });
  });
});
