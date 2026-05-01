import type { TimelineEntry } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { surfaceId } from "./timelineEntry";

function makeEntry(overrides: Partial<TimelineEntry>): TimelineEntry {
  return { id: "1", date: "2026-01-01", status: "planned", planDayId: "pd-1", workoutLogId: null, ...overrides } as TimelineEntry;
}

describe("surfaceId", () => {
  it("prefers planDayId so planned/completed transitions keep one identity", () => {
    const planned = makeEntry({ status: "planned", planDayId: "pd-1", workoutLogId: null });
    const completed = makeEntry({ status: "completed", planDayId: "pd-1", workoutLogId: "wl-1" });
    expect(surfaceId(planned)).toBe("pd-1");
    expect(surfaceId(completed)).toBe("pd-1");
  });

  it("falls back to workoutLogId when unplanned completed/missed has no plan day", () => {
    const completed = makeEntry({ status: "completed", planDayId: null, workoutLogId: "wl-1" });
    const missed = makeEntry({ status: "missed", planDayId: null, workoutLogId: "wl-1" });
    expect(surfaceId(completed)).toBe("wl-1");
    expect(surfaceId(missed)).toBe("wl-1");
  });
});
