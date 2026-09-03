import type { TimelineEntry } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { windowTimelinePage } from "../timelineWindow";

function entry(id: string, date: string): TimelineEntry {
  return { id, date } as TimelineEntry;
}

// Date-desc merge with a two-entry day in the middle, the shape a plan day
// plus a standalone log on the same date produces.
const MERGE = [
  entry("a", "2026-05-08"),
  entry("b", "2026-05-07"),
  entry("c", "2026-05-06"),
  entry("d", "2026-05-06"),
  entry("e", "2026-05-05"),
  entry("f", "2026-05-01"),
];

describe("windowTimelinePage (P3)", () => {
  it("returns everything with no cursor when the merge fits the window", () => {
    expect(windowTimelinePage(MERGE, 0, 10, false)).toEqual({ entries: MERGE, nextCursor: null });
    expect(windowTimelinePage(MERGE, 0, 6, false)).toEqual({ entries: MERGE, nextCursor: null });
  });

  it("cuts a clean page and names the last date as the next exclusive bound", () => {
    const page = windowTimelinePage(MERGE, 0, 2, false);
    expect(page.entries.map((e) => e.id)).toEqual(["a", "b"]);
    expect(page.nextCursor).toBe("2026-05-07");
  });

  it("never splits a date: a window ending inside a day drops that day to the next page", () => {
    const page = windowTimelinePage(MERGE, 0, 3, false);
    expect(page.entries.map((e) => e.id)).toEqual(["a", "b"]);
    expect(page.nextCursor).toBe("2026-05-07");
  });

  it("keeps a day whole when the window ends exactly on its last entry", () => {
    const page = windowTimelinePage(MERGE, 0, 4, false);
    expect(page.entries.map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
    expect(page.nextCursor).toBe("2026-05-06");
  });

  it("treats a source that hit its SQL cap as 'more follows' and drops the possibly partial last day", () => {
    const page = windowTimelinePage(MERGE, 0, 10, true);
    expect(page.entries.map((e) => e.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(page.nextCursor).toBe("2026-05-05");
  });

  it("keeps a single-date window whole rather than returning nothing", () => {
    const sameDay = [entry("x", "2026-05-06"), entry("y", "2026-05-06"), entry("z", "2026-05-06")];
    const page = windowTimelinePage(sameDay, 0, 2, false);
    expect(page.entries.map((e) => e.id)).toEqual(["x", "y"]);
    expect(page.nextCursor).toBe("2026-05-06");
  });

  it("honours a start offset so a caller can anchor the window", () => {
    const page = windowTimelinePage(MERGE, 2, 2, false);
    expect(page.entries.map((e) => e.id)).toEqual(["c", "d"]);
    expect(page.nextCursor).toBe("2026-05-06");
  });

  it("returns an empty page with no cursor for an empty merge", () => {
    expect(windowTimelinePage([], 0, 5, true)).toEqual({ entries: [], nextCursor: null });
  });
});
