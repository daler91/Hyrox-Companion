import type { ExerciseSet } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import type { ExerciseSetWithDate } from "@/lib/api/exercises";

import { LastTimeRow } from "../LastTimeRow";

vi.mock("@/lib/api", () => ({
  api: { exercises: { getHistory: vi.fn() } },
  QUERY_KEYS: {
    exerciseHistory: (name: string, sessions: number) => [
      "/api/v1/exercises",
      name,
      "history",
      sessions,
    ],
  },
}));

function set(overrides: Partial<ExerciseSetWithDate> = {}): ExerciseSetWithDate {
  return {
    id: "set-1",
    exerciseName: "back_squat",
    category: "strength",
    setNumber: 1,
    date: "2026-06-01",
    workoutLogId: "w-old",
    customLabel: null,
    reps: 8,
    weight: 80,
    distance: null,
    time: null,
    ...overrides,
  } as ExerciseSetWithDate;
}

function renderRow(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function row(overrides: Partial<Parameters<typeof LastTimeRow>[0]> = {}) {
  const props = {
    exerciseName: "back_squat",
    category: "strength",
    currentSets: [] as ExerciseSet[],
    weightUnit: "kg" as const,
    distanceUnit: "km" as const,
    onUpdateSet: vi.fn(),
    showUseLast: false,
    ...overrides,
  };
  renderRow(<LastTimeRow {...props} />);
  return props;
}

describe("LastTimeRow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the last session's prescription", async () => {
    vi.mocked(api.exercises.getHistory).mockResolvedValue([
      set({ id: "a", date: "2026-06-10", setNumber: 1 }),
      set({ id: "b", date: "2026-06-10", setNumber: 2 }),
    ]);

    row();

    expect(await screen.findByTestId("last-time-back_squat")).toHaveTextContent(
      "Last time: 2 × 8 reps · 80 kg",
    );
  });

  it("gives screen readers the grammatical form, not the glyphs", async () => {
    vi.mocked(api.exercises.getHistory).mockResolvedValue([set({ date: "2026-06-10" })]);

    row();

    await screen.findByTestId("last-time-back_squat");
    expect(screen.getByText("Last time: 1 set of 8 reps at 80 kg")).toBeInTheDocument();
  });

  it("renders nothing while loading or when there is no history", async () => {
    vi.mocked(api.exercises.getHistory).mockResolvedValue([]);

    row();

    // No skeleton: a placeholder flickering on every row is worse than nothing.
    expect(screen.queryByTestId("last-time-back_squat")).not.toBeInTheDocument();
  });

  it("never asks for a custom exercise's history", () => {
    // The server resolves "custom" to a real exercise name, which would match
    // every custom set the athlete has ever logged, whatever its label.
    row({ exerciseName: "custom" });
    expect(api.exercises.getHistory).not.toHaveBeenCalled();
  });

  it("fills the current sets from the last session on request", async () => {
    vi.mocked(api.exercises.getHistory).mockResolvedValue([
      set({ id: "l1", date: "2026-06-10", setNumber: 1, reps: 8, weight: 80 }),
      set({ id: "l2", date: "2026-06-10", setNumber: 2, reps: 6, weight: 85 }),
    ]);
    const props = row({
      currentSets: [
        set({ id: "c1", reps: null, weight: null }),
        set({ id: "c2", reps: null, weight: null }),
      ] as ExerciseSet[],
      showUseLast: true,
    });

    await userEvent.click(await screen.findByTestId("use-last-back_squat"));

    expect(props.onUpdateSet).toHaveBeenCalledWith("c1", { reps: 8, weight: 80 });
    expect(props.onUpdateSet).toHaveBeenCalledWith("c2", { reps: 6, weight: 85 });
  });

  it("offers the fill only when the row is open to receive it", async () => {
    vi.mocked(api.exercises.getHistory).mockResolvedValue([set({ date: "2026-06-10" })]);

    row({ currentSets: [set({ id: "c1" })] as ExerciseSet[], showUseLast: false });

    await screen.findByTestId("last-time-back_squat");
    expect(screen.queryByTestId("use-last-back_squat")).not.toBeInTheDocument();
  });
});
