import type { Active, ClientRect, DroppableContainer } from "@dnd-kit/core";
import type { TimelineEntry } from "@shared/schema";
import { afterEach, describe, expect, it, vi } from "vitest";

import { allowedDropTargets, canMoveEntryTo, timelineCollisionDetection } from "../dropTargets";

const TODAY = "2026-10-06";

function entry(fields: Partial<TimelineEntry>): TimelineEntry {
  return { id: "entry-1", date: "2026-10-01", status: "completed", ...fields } as TimelineEntry;
}

const LOGGED = entry({ workoutLogId: "log-1" });
const PLANNED = entry({ planDayId: "pd-1", status: "planned", date: "2026-10-08" });

function dayRow(date: string): DroppableContainer {
  return {
    id: `timeline-date:${date}`,
    key: `timeline-date:${date}`,
    data: { current: { date } },
    disabled: false,
    node: { current: null },
    rect: { current: null },
  };
}

const DAYS = ["2026-10-05", TODAY, "2026-10-07", "2026-10-08", "2026-10-13"].map(dayRow);

const ids = (containers: readonly { id: unknown }[]) => containers.map(({ id }) => id);

// CL70 (CODEBASE_ANALYSIS_2026-10-03): every future day lit up as a target for
// a logged workout, and each such drop failed with "Couldn't move workout".
describe("canMoveEntryTo", () => {
  it("lets a logged workout move back in time or as far as tomorrow", () => {
    expect(canMoveEntryTo(LOGGED, "2026-09-01", TODAY)).toBe(true);
    expect(canMoveEntryTo(LOGGED, TODAY, TODAY)).toBe(true);
    expect(canMoveEntryTo(LOGGED, "2026-10-07", TODAY)).toBe(true);
    expect(canMoveEntryTo(LOGGED, "2026-10-08", TODAY)).toBe(false);
  });

  it("lets a planned session move to any day", () => {
    expect(canMoveEntryTo(PLANNED, "2027-01-01", TODAY)).toBe(true);
  });
});

describe("allowedDropTargets", () => {
  it("drops the days after tomorrow for a logged workout", () => {
    expect(ids(allowedDropTargets(LOGGED, DAYS, TODAY))).toEqual([
      "timeline-date:2026-10-05",
      "timeline-date:2026-10-06",
      "timeline-date:2026-10-07",
    ]);
  });

  it("keeps every day for a planned session, and for a drag that carries no entry", () => {
    expect(allowedDropTargets(PLANNED, DAYS, TODAY)).toEqual(DAYS);
    expect(allowedDropTargets(undefined, DAYS, TODAY)).toEqual(DAYS);
  });
});

describe("timelineCollisionDetection", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Every day row sits under the dragged card, so only the filter decides.
  function collide(dragged: TimelineEntry): unknown[] {
    const rect: ClientRect = { top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100 };
    const active = { id: dragged.id, data: { current: { entry: dragged } } } as unknown as Active;
    return ids(
      timelineCollisionDetection({
        active,
        collisionRect: rect,
        droppableRects: new Map(DAYS.map((day) => [day.id, rect])),
        droppableContainers: DAYS,
        pointerCoordinates: null,
      }),
    );
  }

  it("never reports a day the logged workout cannot move to as the drop target", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 6, 12));

    expect(collide(LOGGED)).not.toContain("timeline-date:2026-10-08");
    expect(collide(LOGGED)).not.toContain("timeline-date:2026-10-13");
    expect(collide(LOGGED)).toContain("timeline-date:2026-10-07");
    expect(collide(PLANNED)).toContain("timeline-date:2026-10-13");
  });
});
