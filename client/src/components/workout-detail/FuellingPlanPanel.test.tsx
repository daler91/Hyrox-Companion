import type { TimelineEntry } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api, QUERY_KEYS } from "@/lib/api";

import { FuellingPlanPanel } from "./FuellingPlanPanel";

vi.mock("@/lib/api", () => ({
  api: { plans: { updateDayWithoutPlan: vi.fn().mockResolvedValue({}) } },
  QUERY_KEYS: {
    preferences: ["/api/v1/preferences"],
    timeline: ["/api/v1/timeline"],
  },
}));

type Blocks = TimelineEntry["structureBlocks"];

function makeEntry(over: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    id: "entry-1",
    date: "2026-06-09",
    type: "planned",
    status: "planned",
    focus: "Strength",
    mainWorkout: "5x5 squat",
    accessory: null,
    notes: null,
    planDayId: "day-1",
    ...over,
  };
}

function renderWithClient(ui: ReactNode, bodyweightKg: number | null = 75) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  if (bodyweightKg !== null) {
    queryClient.setQueryData(QUERY_KEYS.preferences, { bodyweightKg });
  }
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("FuellingPlanPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a target estimated from the planned exercise table", () => {
    const entry = makeEntry({
      structureBlocks: [
        { sectionType: "main", formatType: "for_time", timeCapMinutes: 45 },
      ] as unknown as Blocks,
    });
    renderWithClient(<FuellingPlanPanel entry={entry} />);

    expect(screen.getByTestId("fuelling-plan-pre-target")).toHaveTextContent("carbs");
    expect(screen.getByTestId("fuelling-plan-post-target")).toHaveTextContent("protein");
    expect(screen.getByTestId("fuelling-plan-estimate-note")).toBeInTheDocument();
  });

  it("prefers the saved expected values over the exercise-table estimate", async () => {
    const user = userEvent.setup();
    const entry = makeEntry({
      expectedDurationMin: 90,
      expectedRpe: 9,
      structureBlocks: [
        { sectionType: "main", formatType: "steady", durationMinutes: 20 },
      ] as unknown as Blocks,
    });
    renderWithClient(<FuellingPlanPanel entry={entry} />);

    // The adjusters are collapsed once a duration is known — open them first.
    await user.click(screen.getByTestId("fuelling-plan-adjust"));
    expect(screen.getByTestId("fuelling-plan-duration")).toHaveValue(90);
    expect(screen.queryByTestId("fuelling-plan-estimate-note")).not.toBeInTheDocument();
  });

  it("collapses the adjusters by default once a duration is known, and shows the assumption", () => {
    const entry = makeEntry({ expectedDurationMin: 60, expectedRpe: 7 });
    renderWithClient(<FuellingPlanPanel entry={entry} />);

    const adjust = screen.getByTestId("fuelling-plan-adjust");
    expect(adjust).toHaveTextContent("Adjust session estimate · 60 min · RPE 7");
    // <details> ancestor is closed so the controls are not exposed.
    expect(adjust.closest("details")).not.toHaveAttribute("open");
  });

  it("opens the adjusters by default when there is nothing to estimate from", () => {
    renderWithClient(<FuellingPlanPanel entry={makeEntry()} />);

    expect(screen.getByTestId("fuelling-plan-adjust").closest("details")).toHaveAttribute("open");
  });

  it("shows a baseline target plus a hint when there is nothing to estimate from", () => {
    renderWithClient(<FuellingPlanPanel entry={makeEntry()} />);

    expect(screen.getByTestId("fuelling-plan-hint")).toBeInTheDocument();
    expect(screen.getByTestId("fuelling-plan-post-target")).toHaveTextContent("carbs");
  });

  it("prompts for bodyweight when none is set", () => {
    renderWithClient(
      <FuellingPlanPanel entry={makeEntry({ expectedDurationMin: 60, expectedRpe: 6 })} />,
      null,
    );

    expect(screen.getByTestId("fuelling-plan-bodyweight-hint")).toBeInTheDocument();
  });

  it("persists an edited expected effort to the plan day", async () => {
    const user = userEvent.setup();
    renderWithClient(<FuellingPlanPanel entry={makeEntry({ expectedDurationMin: 60 })} />);

    await user.click(screen.getByTestId("fuelling-plan-adjust"));
    await user.click(screen.getByTestId("button-rpe-8"));

    await waitFor(() =>
      expect(api.plans.updateDayWithoutPlan).toHaveBeenCalledWith("day-1", { expectedRpe: 8 }),
    );
  });
});
