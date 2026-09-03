import type { ExerciseSet } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { LastTimeRow } from "../LastTimeRow";
import { makeLoggedSet as set } from "./exerciseSetFixture";

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
    expect(screen.queryByTestId("use-next-back_squat")).not.toBeInTheDocument();
  });

  it("suggests the next target alongside last time", async () => {
    vi.mocked(api.exercises.getHistory).mockResolvedValue([
      set({ id: "a", date: "2026-06-10", setNumber: 1 }),
      set({ id: "b", date: "2026-06-10", setNumber: 2 }),
    ]);

    row();

    // 80 kg × 8 progresses by the gentler overload: a rep, not a plate.
    expect(await screen.findByTestId("next-target-back_squat")).toHaveTextContent(
      "Next: 2 × 9 reps · 80 kg",
    );
    expect(screen.getByText("+1 rep")).toBeInTheDocument();
  });

  it("tells screen readers what the suggestion changes", async () => {
    vi.mocked(api.exercises.getHistory).mockResolvedValue([set({ date: "2026-06-10" })]);

    row();

    await screen.findByTestId("next-target-back_squat");
    expect(
      screen.getByText("Suggested next: 1 set of 9 reps at 80 kg, up 1 rep on last time"),
    ).toBeInTheDocument();
  });

  it("fills every current set with the suggested target on request", async () => {
    vi.mocked(api.exercises.getHistory).mockResolvedValue([
      set({ id: "l1", date: "2026-06-10", setNumber: 1 }),
      set({ id: "l2", date: "2026-06-10", setNumber: 2 }),
    ]);
    const props = row({
      currentSets: [
        set({ id: "c1", reps: null, weight: null }),
        set({ id: "c2", reps: null, weight: null }),
      ] as ExerciseSet[],
      showUseLast: true,
    });

    await userEvent.click(await screen.findByTestId("use-next-back_squat"));

    expect(props.onUpdateSet).toHaveBeenCalledWith("c1", { reps: 9, weight: 80 });
    expect(props.onUpdateSet).toHaveBeenCalledWith("c2", { reps: 9, weight: 80 });
  });

  it("keeps the last-time line but drops the suggestion when the maths has no footing", async () => {
    // A pyramid has no single prescription to progress.
    vi.mocked(api.exercises.getHistory).mockResolvedValue([
      set({ id: "a", date: "2026-06-10", setNumber: 1, weight: 80 }),
      set({ id: "b", date: "2026-06-10", setNumber: 2, weight: 90 }),
    ]);

    row();

    await screen.findByTestId("last-time-back_squat");
    expect(screen.queryByTestId("next-target-back_squat")).not.toBeInTheDocument();
  });
});

describe("LastTimeRow unit stamps (finding D2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads a kg-stamped session in pounds for a lb athlete, and progresses from the pounds", async () => {
    vi.mocked(api.exercises.getHistory).mockResolvedValue([
      set({ id: "l1", date: "2026-06-10", reps: 8, weight: 100, weightUnit: "kg" }),
    ]);
    const props = row({
      weightUnit: "lb",
      distanceUnit: "miles",
      currentSets: [set({ id: "c1", reps: null, weight: null })] as ExerciseSet[],
      showUseLast: true,
    });

    expect(await screen.findByTestId("last-time-back_squat")).toHaveTextContent(
      "Last time: 1 × 8 reps · 220 lb",
    );
    // 220 lb × 8: a 5 lb plate (6.3 lb of estimated 1RM) is the gentler step
    // versus a rep (7.3 lb). Read raw as "100 lb" the suggestion was +1 rep.
    expect(screen.getByTestId("next-target-back_squat")).toHaveTextContent(
      "Next: 1 × 8 reps · 225 lb",
    );
    expect(screen.getByText("+5 lb")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("use-last-back_squat"));
    expect(props.onUpdateSet).toHaveBeenCalledWith("c1", { reps: 8, weight: 220 });

    await userEvent.click(screen.getByTestId("use-next-back_squat"));
    expect(props.onUpdateSet).toHaveBeenCalledWith("c1", { reps: 8, weight: 225 });
  });

  it("reads a feet-stamped run in metres for a km athlete", async () => {
    vi.mocked(api.exercises.getHistory).mockResolvedValue([
      set({
        id: "l1",
        date: "2026-06-10",
        exerciseName: "easy_run",
        category: "running",
        reps: null,
        weight: null,
        distance: 1312,
        distanceUnit: "ft",
      }),
    ]);

    row({ exerciseName: "easy_run", category: "running" });

    expect(await screen.findByTestId("last-time-easy_run")).toHaveTextContent("Last time: 1 × 400 m");
  });
});
