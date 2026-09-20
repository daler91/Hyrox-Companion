import type { TimelineEntry } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import TimelineWorkoutCard from "../timeline-workout-card";

// An AI-generated plan carries the athlete's whole goal sentence as its name.
const LONG_PLAN_NAME = "AI Plan: I want to run a fast 45 min 10k on on Oct 10th";

const entry = {
  id: "entry-1",
  date: "2026-09-17",
  type: "planned",
  status: "planned",
  focus: "Strength",
  mainWorkout: "Hyrox stations circuit",
  accessory: null,
  notes: null,
  planDayId: "day-1",
  planName: LONG_PLAN_NAME,
} as unknown as TimelineEntry;

function renderCard(overrides: Partial<TimelineEntry> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async () => ({ weightUnit: "kg", distanceUnit: "km" }),
      },
    },
  });
  queryClient.setQueryData(["/api/v1/preferences"], { weightUnit: "kg", distanceUnit: "km" });

  return render(
    <QueryClientProvider client={queryClient}>
      <TimelineWorkoutCard
        entry={{ ...entry, ...overrides }}
        onClick={vi.fn()}
        onMarkComplete={vi.fn()}
        onMove={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("TimelineWorkoutCard plan badge", () => {
  it("caps a long plan name to the card row and ellipsizes it instead of overflowing", () => {
    renderCard();
    const badge = screen.getByTestId("badge-plan-entry-1");
    // Badge never wraps (whitespace-nowrap), so without a width cap the chip
    // ran past the card edge on phones. The cap plus the truncating text span
    // is what keeps it inside the card.
    expect(badge.className).toContain("max-w-full");
    expect(badge.className).toContain("min-w-0");
    const text = badge.querySelector("span.truncate");
    expect(text).not.toBeNull();
    expect(text).toHaveTextContent(LONG_PLAN_NAME);
  });

  it("keeps the full plan name available as a tooltip once it is clipped", () => {
    renderCard();
    expect(screen.getByTestId("badge-plan-entry-1")).toHaveAttribute("title", LONG_PLAN_NAME);
  });

  it("reserves room in the header for the move controls on touch widths", () => {
    renderCard();
    const header = screen.getByTestId("badge-plan-entry-1").parentElement;
    expect(header?.className).toContain("pr-[4.5rem]");
    expect(header?.className).toContain("md:pr-16");
  });

  it("renders no plan badge when the entry has no plan", () => {
    renderCard({ planName: null });
    expect(screen.queryByTestId("badge-plan-entry-1")).not.toBeInTheDocument();
  });
});
