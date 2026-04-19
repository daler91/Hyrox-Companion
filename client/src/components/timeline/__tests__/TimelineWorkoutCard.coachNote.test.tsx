import "@testing-library/jest-dom/vitest";

import type { TimelineEntry } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import TimelineWorkoutCard from "../timeline-workout-card";

const baseEntry = {
  id: "entry-1",
  date: "2026-04-20",
  type: "planned",
  status: "planned",
  focus: "Intervals",
  mainWorkout: "6x400m @ 5K pace",
  accessory: null,
  notes: null,
  planDayId: "plan-day-1",
} as unknown as TimelineEntry;

function renderCard(entry: TimelineEntry) {
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
      <TimelineWorkoutCard entry={entry} onClick={vi.fn()} onMarkComplete={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("TimelineWorkoutCard — Coach's note integration", () => {
  it("renders no Coach's note when aiRationale is missing", () => {
    renderCard(baseEntry);
    expect(screen.queryByTestId(/coach-note-/)).toBeNull();
  });

  it("renders the Coach's note pill when aiRationale + aiSource are set", () => {
    renderCard({
      ...baseEntry,
      aiSource: "review",
      aiRationale: "Left as-is — your build-phase volume looks appropriate.",
      aiNoteUpdatedAt: new Date(Date.now() - 1000 * 60 * 30),
      aiInputsUsed: {
        planPhase: "build",
        rpeTrend: "stable",
        ragUsed: false,
        recentWorkoutCount: 4,
      },
    } as unknown as TimelineEntry);

    const toggle = screen.getByTestId("coach-note-toggle-entry-1");
    expect(toggle).toHaveTextContent(/Coach's note/);
  });

  it("toggling the note does not trigger the card's onClick", () => {
    const onClick = vi.fn();
    const entry = {
      ...baseEntry,
      aiSource: "rag",
      aiRationale: "Swapped intervals for Zone 2 — rising RPE trend warrants recovery.",
      aiNoteUpdatedAt: new Date(),
      aiInputsUsed: { rpeTrend: "rising", fatigueFlag: true, ragUsed: true },
    } as unknown as TimelineEntry;

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, queryFn: async () => ({}) } },
    });
    queryClient.setQueryData(["/api/v1/preferences"], { weightUnit: "kg", distanceUnit: "km" });

    render(
      <QueryClientProvider client={queryClient}>
        <TimelineWorkoutCard entry={entry} onClick={onClick} onMarkComplete={vi.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByTestId("coach-note-toggle-entry-1"));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByTestId("coach-note-rationale-entry-1")).toHaveTextContent(/Zone 2/);
  });
});
