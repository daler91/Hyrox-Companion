import type { TimelineEntry } from "@shared/schema";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { createMockTimelineEntry } from "../../../../../test/factories";
import { useTimelineSurfaceSelection } from "../useTimelineSurfaceSelection";

/**
 * Drives the hook against the REAL URL hook (wouter over jsdom history), so
 * the state→URL and URL→state effects run exactly as they do on the page.
 * The buttons mirror what TimelineWorkoutSurfaces does: "open" is a card
 * click, "reopen" is the review sheet's "Reopen workout" (it clears the sheet
 * state and leaves the URL to the hook), "close" is the sheet's own close.
 */
function Harness({ timelineData }: { readonly timelineData: TimelineEntry[] }) {
  const selection = useTimelineSurfaceSelection(timelineData);
  return (
    <div>
      {timelineData.map((entry) => (
        <button key={entry.id} type="button" onClick={() => selection.openSurface(entry)}>
          {`open ${entry.id}`}
        </button>
      ))}
      {selection.reviewEntry ? (
        <div data-testid="review">
          {selection.reviewEntry.id}
          <button type="button" onClick={() => selection.setReviewEntry(null)}>
            reopen
          </button>
          <button type="button" onClick={selection.closeAllSurfacesAndClearUrl}>
            close
          </button>
        </div>
      ) : null}
      {selection.logEntry ? <div data-testid="log">{selection.logEntry.id}</div> : null}
    </div>
  );
}

const completed = createMockTimelineEntry({
  id: "log-wl1",
  date: "2020-01-01",
  status: "completed",
  planDayId: "pd1",
  workoutLogId: "wl1",
});

const otherCompleted = createMockTimelineEntry({
  id: "log-wl2",
  date: "2020-01-02",
  status: "completed",
  planDayId: "pd2",
  workoutLogId: "wl2",
});

function search(): string {
  return globalThis.window.location.search;
}

async function settle() {
  await act(async () => {});
}

describe("useTimelineSurfaceSelection", () => {
  beforeEach(() => {
    globalThis.window.history.replaceState(null, "", "/");
  });

  it("does not resurrect a sheet the page closed while the URL still named it", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness timelineData={[completed]} />);

    await user.click(screen.getByText("open log-wl1"));
    expect(screen.getByTestId("review")).toHaveTextContent("log-wl1");
    expect(search()).toBe("?workout=pd1");

    // "Reopen workout": the sheet state is cleared and the plan-day status
    // mutation runs. The log behind this entry is about to be deleted, so a
    // revived sheet would be editing a workout that no longer exists.
    await user.click(screen.getByText("reopen"));
    await settle();

    expect(screen.queryByTestId("review")).not.toBeInTheDocument();
    expect(search()).toBe("");

    // The optimistic status flip lands afterwards; it must not open anything.
    rerender(<Harness timelineData={[{ ...completed, status: "planned" }]} />);
    await settle();
    expect(screen.queryByTestId("review")).not.toBeInTheDocument();
    expect(screen.queryByTestId("log")).not.toBeInTheDocument();
  });

  it("still opens the sheet again from a fresh card click after it was closed", async () => {
    const user = userEvent.setup();
    render(<Harness timelineData={[completed]} />);

    await user.click(screen.getByText("open log-wl1"));
    await user.click(screen.getByText("reopen"));
    await settle();
    expect(screen.queryByTestId("review")).not.toBeInTheDocument();

    await user.click(screen.getByText("open log-wl1"));
    expect(screen.getByTestId("review")).toHaveTextContent("log-wl1");
    expect(search()).toBe("?workout=pd1");
  });

  it("closes and clears the URL through the sheet's own close", async () => {
    const user = userEvent.setup();
    render(<Harness timelineData={[completed]} />);

    await user.click(screen.getByText("open log-wl1"));
    await user.click(screen.getByText("close"));
    await settle();

    expect(screen.queryByTestId("review")).not.toBeInTheDocument();
    expect(search()).toBe("");
  });

  it("opens a deep link once the timeline data that satisfies it arrives", async () => {
    globalThis.window.history.replaceState(null, "", "/?workout=pd1");
    const { rerender } = render(<Harness timelineData={[]} />);
    await settle();
    expect(screen.queryByTestId("review")).not.toBeInTheDocument();

    rerender(<Harness timelineData={[completed]} />);
    await settle();
    expect(screen.getByTestId("review")).toHaveTextContent("log-wl1");
  });

  it("re-opens the sheet when navigation brings the workout param back after a close", async () => {
    const user = userEvent.setup();
    render(<Harness timelineData={[completed]} />);

    await user.click(screen.getByText("open log-wl1"));
    await user.click(screen.getByText("reopen"));
    await settle();
    expect(screen.queryByTestId("review")).not.toBeInTheDocument();

    // Same id as the one just closed: it is the URL that changed this time,
    // so the guard must not mistake it for the close it already handled.
    act(() => {
      globalThis.window.history.pushState(null, "", "/?workout=pd1");
    });
    await settle();
    expect(screen.getByTestId("review")).toHaveTextContent("log-wl1");
  });

  it("switches sheets without bouncing back to the one the URL still named", async () => {
    const user = userEvent.setup();
    render(<Harness timelineData={[completed, otherCompleted]} />);

    await user.click(screen.getByText("open log-wl1"));
    expect(search()).toBe("?workout=pd1");

    await user.click(screen.getByText("open log-wl2"));
    await settle();

    expect(screen.getByTestId("review")).toHaveTextContent("log-wl2");
    expect(search()).toBe("?workout=pd2");
  });
});
