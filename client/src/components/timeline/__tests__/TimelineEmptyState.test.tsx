import type { TrainingPlan } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import TimelineEmptyState from "../TimelineEmptyState";
import type { FilterStatus } from "../types";

// Regression guard for the Codex P1 fix preserved from the now-deleted
// TimelineAnnotationsBanner test: a clean account (no plans, no workouts)
// must still have a visible entry point to the AnnotationsDialog. Before
// this PR, that entry point was the banner; now it's the "Log a note"
// button rendered inside every empty-state variant.

function makePlan(overrides: Partial<TrainingPlan> = {}): TrainingPlan {
  return {
    id: "plan-1",
    userId: "u-1",
    name: "Test Plan",
    sourceFileName: null,
    totalWeeks: 8,
    goal: null,
    startDate: null,
    endDate: null,
    ...overrides,
  };
}

interface RenderProps {
  readonly filterStatus?: FilterStatus;
  readonly selectedPlanId?: string | null;
  readonly plans?: TrainingPlan[];
  readonly onLogNote?: () => void;
}

function renderEmptyState({
  filterStatus = "all",
  selectedPlanId = null,
  plans = [],
  onLogNote,
}: RenderProps = {}) {
  // The welcome variant eagerly mounts GeneratePlanDialog, which uses
  // react-query hooks internally — so this test needs a provider.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TimelineEmptyState
        filterStatus={filterStatus}
        selectedPlanId={selectedPlanId}
        plans={plans}
        samplePlanMutation={{ mutate: vi.fn(), isPending: false }}
        importMutation={{ isPending: false }}
        handleFileUpload={vi.fn()}
        setSchedulingPlanId={vi.fn()}
        setFilterStatus={vi.fn()}
        onLogNote={onLogNote}
      />
    </QueryClientProvider>,
  );
}

describe("TimelineEmptyState", () => {
  describe("welcome variant (no plans, no filter)", () => {
    it("renders the Log a note button when onLogNote is provided", async () => {
      const onLogNote = vi.fn();
      renderEmptyState({ onLogNote });

      const button = await screen.findByTestId("button-log-note-empty");
      expect(button).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(button);
      expect(onLogNote).toHaveBeenCalledTimes(1);
    });

    it("does not render the Log a note button when onLogNote is omitted", () => {
      renderEmptyState();
      expect(screen.queryByTestId("button-log-note-empty")).toBeNull();
    });
  });

  describe("ready variant (has plan, no scheduled workouts)", () => {
    it("renders the Log a note button alongside Set Start Date when onLogNote is provided", async () => {
      const onLogNote = vi.fn();
      renderEmptyState({
        filterStatus: "all",
        selectedPlanId: "plan-1",
        plans: [makePlan({ id: "plan-1", name: "8 Week Plan" })],
        onLogNote,
      });

      expect(screen.getByTestId("button-set-start-date")).toBeInTheDocument();
      const button = screen.getByTestId("button-log-note-empty");
      expect(button).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(button);
      expect(onLogNote).toHaveBeenCalledTimes(1);
    });
  });

  describe("no-workouts variant (filter applied, no matches)", () => {
    it("renders the Log a note button alongside Show All when onLogNote is provided", async () => {
      const onLogNote = vi.fn();
      renderEmptyState({
        filterStatus: "completed",
        selectedPlanId: null,
        plans: [],
        onLogNote,
      });

      expect(screen.getByTestId("button-clear-filter")).toBeInTheDocument();
      const button = screen.getByTestId("button-log-note-empty");
      expect(button).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(button);
      expect(onLogNote).toHaveBeenCalledTimes(1);
    });
  });
});
