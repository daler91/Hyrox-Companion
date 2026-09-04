import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { QUERY_KEYS } from "@/lib/api";
import type { TimelineCache, TimelinePage } from "@/lib/timelineCache";

import { Breadcrumbs } from "../Breadcrumbs";

function renderWithWorkout(client: QueryClient, workoutId: string) {
  const { hook } = memoryLocation({ path: `/?workout=${workoutId}` });
  return render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <Breadcrumbs />
      </Router>
    </QueryClientProvider>,
  );
}

function timelineCacheWith(entries: TimelinePage["entries"]): TimelineCache {
  return {
    pages: [{ entries, nextCursor: null }],
    pageParams: [null],
  };
}

describe("Breadcrumbs workout label", () => {
  it("shows the fallback until a matching timeline entry loads, then the entry's label", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, queryFn: async () => null } },
    });
    renderWithWorkout(client, "workout-1");

    expect(screen.getByTestId("breadcrumb-current")).toHaveTextContent("Workout");

    client.setQueryData<TimelineCache>(
      QUERY_KEYS.timeline,
      timelineCacheWith([
        {
          id: "entry-1",
          date: "2026-09-01",
          type: "logged",
          status: "completed",
          focus: "Deadlift Day",
          mainWorkout: "Deadlift Day",
          accessory: null,
          notes: null,
          workoutLogId: "workout-1",
          planDayId: null,
        },
      ]),
    );

    await waitFor(() =>
      expect(screen.getByTestId("breadcrumb-current")).toHaveTextContent("Deadlift Day"),
    );
  });

  it("does not re-render the label on a cache event that carries no new data (fetch-start)", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, queryFn: async () => null } },
    });
    client.setQueryData<TimelineCache>(
      QUERY_KEYS.timeline,
      timelineCacheWith([
        {
          id: "entry-1",
          date: "2026-09-01",
          type: "logged",
          status: "completed",
          focus: "Deadlift Day",
          mainWorkout: "Deadlift Day",
          accessory: null,
          notes: null,
          workoutLogId: "workout-1",
          planDayId: null,
        },
      ]),
    );
    renderWithWorkout(client, "workout-1");
    await waitFor(() =>
      expect(screen.getByTestId("breadcrumb-current")).toHaveTextContent("Deadlift Day"),
    );

    // A fetch-start/invalidate notify event (no data change) must not blank
    // out or otherwise disturb an already-resolved label.
    client.getQueryCache().find({ queryKey: QUERY_KEYS.timeline })?.invalidate();

    expect(screen.getByTestId("breadcrumb-current")).toHaveTextContent("Deadlift Day");
  });
});
