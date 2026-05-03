import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildTimelineEntry, buildTimelineStatePayload, renderTimelineWithState } from "./timelineTestHarness";

const setOpenWorkoutId = vi.fn();
const missedEntry = buildTimelineEntry({
  id: "entry-missed",
  status: "missed",
  planDayId: "plan-day-1",
});

beforeEach(() => {
  setOpenWorkoutId.mockClear();
});

describe("Timeline missed click routing", () => {
  it("routes deep-linked missed entry id to LogSheet", async () => {
    renderTimelineWithState({
      timelineState: buildTimelineStatePayload([missedEntry]),
      openWorkoutId: missedEntry.planDayId ?? null,
      setOpenWorkoutIdImpl: setOpenWorkoutId,
      logSheetImpl: ({ entry }) => (entry ? <div data-testid="log-sheet">{entry.status}</div> : null),
    });

    expect(await screen.findByTestId("log-sheet")).toHaveTextContent("missed");
  });
});
