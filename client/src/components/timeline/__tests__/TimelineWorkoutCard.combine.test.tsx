import type { TimelineEntry } from "@shared/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import TimelineWorkoutCard from "../timeline-workout-card";
import type { TimelineWorkoutCardProps } from "../timeline-workout-card/types";

// Combine mode (A3, CODEBASE_ANALYSIS_2026-10-03): once a workout is picked
// from its review sheet, every card tap is a combine decision, and the
// accessible name says what the tap will do.
const logged = {
  id: "log-2",
  date: "2026-05-01",
  type: "logged",
  status: "completed",
  focus: "Easy run",
  mainWorkout: "5 km easy",
  accessory: null,
  notes: null,
  workoutLogId: "wl-2",
} as TimelineEntry;

function renderCard(props: Partial<TimelineWorkoutCardProps>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(["/api/v1/preferences"], { weightUnit: "kg", distanceUnit: "km" });
  const onClick = vi.fn();
  const onCombineSelect = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <TimelineWorkoutCard
        entry={logged}
        onClick={onClick}
        onMarkComplete={vi.fn()}
        onCombineSelect={onCombineSelect}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onClick, onCombineSelect, user: userEvent.setup() };
}

describe("TimelineWorkoutCard combine mode (A3)", () => {
  it("opens the workout when combine mode is off", async () => {
    const { onClick, onCombineSelect, user } = renderCard({});

    await user.click(screen.getByRole("button", { name: "Easy run, completed" }));

    expect(onClick).toHaveBeenCalledWith(logged);
    expect(onCombineSelect).not.toHaveBeenCalled();
  });

  it("offers a logged workout on the same day as the second workout", async () => {
    const { onClick, onCombineSelect, user } = renderCard({
      isCombining: true,
      combiningEntryId: "log-1",
      combiningEntryDate: "2026-05-01",
    });

    await user.click(screen.getByRole("button", { name: "Combine with Easy run, completed" }));

    expect(onCombineSelect).toHaveBeenCalledWith(logged);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("lets the source card cancel combine mode", async () => {
    const { onCombineSelect, user } = renderCard({
      isCombining: true,
      combiningEntryId: "log-2",
      combiningEntryDate: "2026-05-01",
    });

    await user.click(screen.getByRole("button", { name: "Cancel combining Easy run, completed" }));

    expect(onCombineSelect).toHaveBeenCalledWith(logged);
  });

  it("routes a card on another day to the combine handler rather than opening it", async () => {
    const { onClick, onCombineSelect, user } = renderCard({
      isCombining: true,
      combiningEntryId: "log-1",
      combiningEntryDate: "2026-04-30",
    });

    await user.click(screen.getByRole("button", { name: "Easy run, completed" }));

    expect(onCombineSelect).toHaveBeenCalledWith(logged);
    expect(onClick).not.toHaveBeenCalled();
  });
});
