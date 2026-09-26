import type { TimelineEntry } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { format, subDays } from "date-fns";
import { describe, expect, it, vi } from "vitest";

import type { RecoverEntryHandler } from "../missed-recovery";
import TimelineWorkoutCard from "../timeline-workout-card";

const daysAgo = (days: number) => format(subDays(new Date(), days), "yyyy-MM-dd");

const missed = {
  id: "plan-pd-1",
  date: daysAgo(2),
  type: "planned",
  status: "missed",
  focus: "Threshold run",
  mainWorkout: "5 x 1 km at threshold",
  accessory: null,
  notes: null,
  planDayId: "pd-1",
  priority: "key",
  // The server's call: recent, undecided, a real session.
  recoverable: true,
} as TimelineEntry;

function renderCard(overrides: Partial<TimelineEntry> = {}, props: { isBulkSelectMode?: boolean } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: async () => ({ weightUnit: "kg", distanceUnit: "km" }) } },
  });
  queryClient.setQueryData(["/api/v1/preferences"], { weightUnit: "kg", distanceUnit: "km" });
  const onClick = vi.fn();
  const onRecover = vi.fn<RecoverEntryHandler>();
  render(
    <QueryClientProvider client={queryClient}>
      <TimelineWorkoutCard
        entry={{ ...missed, ...overrides }}
        onClick={onClick}
        onMarkComplete={vi.fn()}
        onRecover={onRecover}
        isBulkSelectMode={props.isBulkSelectMode}
      />
    </QueryClientProvider>,
  );
  return { onClick, onRecover };
}

describe("TimelineWorkoutCard missed-session recovery", () => {
  it("turns the missed card into a decision rather than a red square", () => {
    renderCard();

    expect(screen.getByTestId("badge-missed")).toHaveClass("text-warning");
    expect(screen.getByTestId("card-timeline-entry-plan-pd-1").className).toContain("border-warning/30");
    expect(screen.getByTestId("card-timeline-entry-plan-pd-1").className).not.toContain("red");
    expect(screen.getByTestId("badge-priority-key-plan-pd-1")).toHaveTextContent("Key");
    expect(screen.getByTestId("missed-recovery-prompt-plan-pd-1")).toHaveTextContent(
      "A key session — worth fitting back in.",
    );
  });

  it("opens recovery on the tapped option without opening the log sheet", async () => {
    const user = userEvent.setup();
    const { onClick, onRecover } = renderCard();

    await user.click(screen.getByTestId("missed-recovery-shorten-plan-pd-1"));
    expect(onRecover).toHaveBeenCalledWith(expect.objectContaining({ planDayId: "pd-1" }), "shorten");

    // Keyboard activation must not fall through to the card either.
    screen.getByTestId("missed-recovery-let_go-plan-pd-1").focus();
    await user.keyboard("{Enter}");
    expect(onRecover).toHaveBeenLastCalledWith(expect.objectContaining({ planDayId: "pd-1" }), "let_go");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("reads a let-go quietly, with an undo", async () => {
    const user = userEvent.setup();
    const { onRecover } = renderCard({ recovery: "let_go", recoverable: undefined });

    expect(screen.getByTestId("badge-let-go")).toHaveTextContent("Let go");
    expect(screen.queryByTestId("badge-missed")).toBeNull();
    expect(screen.getByTestId("card-timeline-entry-plan-pd-1").className).not.toContain("warning");
    expect(screen.queryByTestId("missed-recovery-prompt-plan-pd-1")).toBeNull();

    await user.click(screen.getByTestId("missed-let-go-undo-plan-pd-1"));
    expect(onRecover).toHaveBeenCalledWith(expect.objectContaining({ planDayId: "pd-1" }), "reopen");
  });

  it("never asks about a rest day that went by", () => {
    renderCard({ focus: "Rest", mainWorkout: "Complete rest or light walk", priority: undefined, recoverable: undefined });

    expect(screen.getByTestId("badge-rest-day")).toHaveTextContent("Rest day");
    expect(screen.queryByTestId("badge-missed")).toBeNull();
    expect(screen.queryByTestId("missed-recovery-prompt-plan-pd-1")).toBeNull();
  });

  it("says a moved session was missed again", () => {
    renderCard({ recovery: "folded", missedOn: "2026-09-20" });
    expect(screen.getByTestId("missed-recovery-prompt-plan-pd-1")).toHaveTextContent(
      "Missed again after it was moved. What now?",
    );
  });

  it("leads an optional session with letting it go", () => {
    renderCard({ priority: "optional", focus: "Easy run" });
    const buttons = screen.getAllByRole("button").filter((button) => button.dataset.testid?.startsWith("missed-recovery-"));
    expect(buttons.map((button) => button.textContent)).toEqual(["Let it go", "Fold into another day", "Shorten it"]);
  });

  it("reads an older miss as history, without asking", () => {
    // Past the recovery window (or a race-week day, or a retired plan's): the server leaves `recoverable` off.
    renderCard({ date: daysAgo(9), recoverable: undefined });

    expect(screen.queryByTestId("missed-recovery-prompt-plan-pd-1")).toBeNull();
    expect(screen.getByTestId("badge-missed")).toHaveClass("text-muted-foreground");
    expect(screen.getByTestId("card-timeline-entry-plan-pd-1").className).not.toContain("warning");
  });

  it("holds the prompt back while selecting cards to delete", () => {
    renderCard({}, { isBulkSelectMode: true });
    expect(screen.queryByTestId("missed-recovery-prompt-plan-pd-1")).toBeNull();
  });

  it("marks where a recovered session came from, and optional sessions as optional", () => {
    renderCard({ status: "planned", date: "2026-09-25", recovery: "folded", missedOn: "2026-09-22", priority: "optional" });

    expect(screen.getByTestId("badge-recovered-plan-pd-1")).toHaveTextContent("Moved from Tue 22 Sep");
    expect(screen.getByTestId("badge-priority-optional-plan-pd-1")).toHaveTextContent("Optional");
    expect(screen.queryByTestId("missed-recovery-prompt-plan-pd-1")).toBeNull();
  });

  it("marks a shortened session, and leaves supporting sessions unmarked", () => {
    renderCard({ status: "planned", date: "2026-09-25", recovery: "shortened", missedOn: "2026-09-22", priority: "supporting" });

    expect(screen.getByTestId("badge-recovered-plan-pd-1")).toHaveTextContent("Shortened · missed Tue 22 Sep");
    expect(screen.queryByTestId("badge-priority-key-plan-pd-1")).toBeNull();
    expect(screen.queryByTestId("badge-priority-optional-plan-pd-1")).toBeNull();
  });
});
