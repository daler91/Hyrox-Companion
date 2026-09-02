import type { TimelineEntry } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { flattenTimelineCache, mapTimelineCache, type TimelineCache } from "./timelineCache";

function entry(id: string, date: string): TimelineEntry {
  return { id, date, status: "planned" } as TimelineEntry;
}

const cache: TimelineCache = {
  pages: [
    { entries: [entry("a", "2026-05-08"), entry("b", "2026-05-07")], nextCursor: "2026-05-07" },
    { entries: [entry("c", "2026-05-06")], nextCursor: null },
  ],
  pageParams: [null, "2026-05-07"],
};

describe("timelineCache (P3)", () => {
  it("flattens loaded pages newest first and tolerates an empty cache", () => {
    expect(flattenTimelineCache(cache).map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(flattenTimelineCache(undefined)).toEqual([]);
  });

  it("applies a map to every page and keeps the cursors", () => {
    const next = mapTimelineCache(cache, (entries) =>
      entries.map((e) => (e.id === "c" ? { ...e, status: "completed" as const } : e)),
    );
    expect(next?.pages[1].entries[0].status).toBe("completed");
    expect(next?.pages[0].nextCursor).toBe("2026-05-07");
    expect(next?.pageParams).toEqual(cache.pageParams);
  });

  it("applies a filter across page boundaries", () => {
    const next = mapTimelineCache(cache, (entries) => entries.filter((e) => e.id !== "b"));
    expect(flattenTimelineCache(next).map((e) => e.id)).toEqual(["a", "c"]);
  });

  it("returns the same cache object when no page changed, and undefined for an empty cache", () => {
    expect(mapTimelineCache(cache, (entries) => entries)).toBe(cache);
    expect(mapTimelineCache(undefined, (entries) => entries)).toBeUndefined();
  });
});
