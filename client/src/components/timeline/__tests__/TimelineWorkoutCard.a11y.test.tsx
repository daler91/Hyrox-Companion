import type { TimelineEntry } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { format, subDays } from "date-fns";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

import TimelineWorkoutCard from "../timeline-workout-card";

const today = format(new Date(), "yyyy-MM-dd");

// A planned, movable session for today: it renders every control a card can
// carry at once — the complete button, the drag handle, the move menu, the
// notes toggle and the coach note. The old fixture rendered none of them,
// which is how a role="button" card nesting them passed axe.
// U20 (CODEBASE_ANALYSIS_2026-10-03)
const plannedEntry = {
  id: "entry-1",
  date: today,
  type: "planned",
  status: "planned",
  focus: "Upper Body Strength",
  mainWorkout: "4x8 bench press",
  accessory: null,
  notes: "Keep two reps in reserve on every set and rest two minutes between them.",
  planDayId: "pd-1",
  aiRationale: "Lighter push day after Saturday's long run.",
  aiSource: "rag",
} as unknown as TimelineEntry;

// A recent missed key session, so the missed-recovery actions render.
const missedEntry = {
  id: "entry-missed",
  date: format(subDays(new Date(), 2), "yyyy-MM-dd"),
  type: "planned",
  status: "missed",
  focus: "Threshold run",
  mainWorkout: "5 x 1 km at threshold",
  accessory: null,
  notes: null,
  planDayId: "pd-2",
  priority: "key",
  recoverable: true,
} as unknown as TimelineEntry;

function renderCard(overrides: Partial<Parameters<typeof TimelineWorkoutCard>[0]> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        // Prevent react-query from complaining about missing queryFn on
        // any query this component transitively depends on — the test
        // pre-populates the only data the card actually reads.
        queryFn: async () => ({ weightUnit: "kg", distanceUnit: "km" }),
      },
    },
  });
  // useUnitPreferences primes the cache with a preferences fetch; seed it
  // so the hook doesn't block rendering.
  queryClient.setQueryData(["/api/v1/preferences"], { weightUnit: "kg", distanceUnit: "km" });

  const onClick = vi.fn();
  const onMarkComplete = vi.fn();

  const utils = render(
    <QueryClientProvider client={queryClient}>
      <TimelineWorkoutCard
        entry={plannedEntry}
        onClick={onClick}
        onMarkComplete={onMarkComplete}
        onMove={vi.fn()}
        onRecover={vi.fn()}
        {...overrides}
      />
    </QueryClientProvider>,
  );

  return { ...utils, onClick, onMarkComplete, user: userEvent.setup() };
}

describe("TimelineWorkoutCard a11y", () => {
  it("has no automated WCAG violations with every card control rendered", async () => {
    const { container } = renderCard();

    // The fixture must actually carry the controls the rule is about.
    expect(screen.getByTestId("button-complete-entry-1")).toBeInTheDocument();
    expect(screen.getByTestId("drag-handle-entry-1")).toBeInTheDocument();
    expect(screen.getByTestId("move-menu-entry-1")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no automated WCAG violations on a missed card with its recovery actions", async () => {
    const { container } = renderCard({ entry: missedEntry });

    expect(screen.getByTestId("missed-recovery-prompt-entry-missed")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("does not make the card itself a button around its own controls", () => {
    renderCard();
    const card = screen.getByTestId("card-timeline-entry-entry-1");

    expect(card).not.toHaveAttribute("role");
    expect(card).not.toHaveAttribute("tabindex");
  });

  it("opens the card from a title button named by the visible title and status", async () => {
    const { onClick, user } = renderCard();
    const open = screen.getByRole("button", { name: "Upper Body Strength, planned" });

    open.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");

    expect(onClick).toHaveBeenCalledTimes(2);
    expect(onClick).toHaveBeenCalledWith(plannedEntry);
  });

  it("opens the card once when the title button is clicked", async () => {
    const { onClick, user } = renderCard();

    await user.click(screen.getByTestId("button-open-entry-entry-1"));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders an adherence badge when compliance is available on completed logs", () => {
    renderCard({
      entry: {
        ...plannedEntry,
        id: "entry-2",
        type: "logged",
        status: "completed",
        planDayId: "plan-1",
        compliancePct: 82,
      },
    });

    expect(screen.getByTestId("badge-adherence-entry-2")).toHaveTextContent("Adherence 82%");
  });
});
