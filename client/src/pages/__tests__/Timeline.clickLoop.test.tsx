import type { TimelineEntry } from "@shared/schema";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildTimelineEntry, buildTimelineStatePayload, renderTimelineWithState, setHarnessOpenWorkoutId } from "./timelineTestHarness";

const completedEntry = buildTimelineEntry({
  id: "entry-completed",
  type: "planned",
  status: "completed",
  planDayId: "plan-day-42",
  workoutLogId: "log-42",
});

let liveWorkoutId: string | null = null;
let mountCount = 0;
const setOpenWorkoutIdMock = vi.fn();

beforeEach(() => {
  liveWorkoutId = null;
  setHarnessOpenWorkoutId(null);
  mountCount = 0;
  setOpenWorkoutIdMock.mockReset();
  globalThis.window.history.replaceState(null, "", "/");
});

function setOpenWorkoutIdAndRoute(id: string | null) {
  setOpenWorkoutIdMock(id);
  liveWorkoutId = id;
  setHarnessOpenWorkoutId(id);
  const params = new URLSearchParams(globalThis.window.location.search);
  if (id) params.set("workout", id);
  else params.delete("workout");
  const query = params.toString();
  globalThis.window.history.replaceState(null, "", query ? `${globalThis.window.location.pathname}?${query}` : globalThis.window.location.pathname);
}

function renderReviewSurface(entry: TimelineEntry | null, onClose: () => void) {
  if (entry) mountCount += 1;
  return entry ? (
    <div data-testid="review-surface">
      {entry.id}
      <button data-testid="review-surface-close" type="button" onClick={onClose}>Close</button>
    </div>
  ) : null;
}

function renderClickLoopTimeline() {
  return renderTimelineWithState({
    timelineState: buildTimelineStatePayload([completedEntry]),
    openWorkoutId: liveWorkoutId,
    setOpenWorkoutIdImpl: setOpenWorkoutIdAndRoute,
    reviewSurfaceImpl: ({ entry, onClose }) => renderReviewSurface(entry, onClose),
  });
}

function openCompletedWorkout(getByTestId: (id: string) => HTMLElement) {
  act(() => {
    fireEvent.click(getByTestId("timeline-entry"));
  });
}

describe("Timeline click does not loop", () => {
  it("opens a completed workout exactly once and stays open", () => {
    const { getByTestId } = renderClickLoopTimeline();

    openCompletedWorkout(getByTestId);
    expect(getByTestId("review-surface")).toBeTruthy();
    expect(liveWorkoutId).toBe(completedEntry.planDayId);
    expect(mountCount).toBeLessThan(5);
  });

  it("closes from the exit control without route navigation side effects", async () => {
    const { getByTestId } = renderClickLoopTimeline();

    openCompletedWorkout(getByTestId);
    expect(getByTestId("review-surface")).toBeTruthy();
    expect(globalThis.window.location.pathname).toBe("/");
    expect(globalThis.window.location.search).toBe("?workout=plan-day-42");

    act(() => {
      fireEvent.click(getByTestId("review-surface-close"));
    });

    await waitFor(() => {
      expect(setOpenWorkoutIdMock).toHaveBeenCalledWith(null);
    });

    expect(globalThis.window.location.pathname).toBe("/");
    expect(setOpenWorkoutIdMock).toHaveBeenCalledWith("plan-day-42");
    expect(setOpenWorkoutIdMock).toHaveBeenCalledWith(null);
    expect(mountCount).toBeLessThan(5);
  });
});
