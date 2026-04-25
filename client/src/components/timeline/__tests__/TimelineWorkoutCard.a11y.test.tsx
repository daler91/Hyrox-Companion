import type { TimelineEntry } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

import TimelineWorkoutCard from "../timeline-workout-card";

// Minimal TimelineEntry fixture. Fields the card doesn't use are omitted
// and cast away — the component reads date, status, focus, mainWorkout,
// notes and a few optional fields.
const mockEntry = {
  id: "entry-1",
  date: "2026-04-12",
  type: "planned",
  status: "planned",
  focus: "Upper Body Strength",
  mainWorkout: "4x8 bench press",
  accessory: null,
  notes: null,
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
        entry={mockEntry}
        onClick={onClick}
        onMarkComplete={onMarkComplete}
        {...overrides}
      />
    </QueryClientProvider>,
  );

  return { ...utils, onClick, onMarkComplete };
}

describe("TimelineWorkoutCard a11y", () => {
  it("has no automated WCAG violations", async () => {
    const { container } = renderCard();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("exposes a button role with tabIndex=0 so keyboard users can reach the card", () => {
    renderCard();
    const card = screen.getAllByRole("button").find((el) => el.getAttribute("tabindex") === "0");
    expect(card).toBeDefined();
    // The tabIndex=0 card is the outer clickable Card, not the inline
    // "mark complete" button (which is rendered as a real <button>).
    expect(card?.getAttribute("tabindex")).toBe("0");
  });

  it("fires onClick when the Enter key is pressed on a focused card", () => {
    const { onClick } = renderCard();
    const card = screen.getAllByRole("button").find((el) => el.getAttribute("tabindex") === "0");
    if (!card) throw new Error("Expected a focusable card with tabindex=0");
    fireEvent.keyDown(card, { key: "Enter" });
    expect(onClick).toHaveBeenCalledWith(mockEntry);
  });

  it("fires onClick when the Space key is pressed on a focused card", () => {
    const { onClick } = renderCard();
    const card = screen.getAllByRole("button").find((el) => el.getAttribute("tabindex") === "0");
    if (!card) throw new Error("Expected a focusable card with tabindex=0");
    fireEvent.keyDown(card, { key: " " });
    expect(onClick).toHaveBeenCalledWith(mockEntry);
  });

  it("renders an adherence badge when compliance is available on completed logs", () => {
    renderCard({
      entry: {
        ...(mockEntry as TimelineEntry),
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
