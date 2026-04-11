import type { TimelineEntry } from "@shared/schema";
import { act,renderHook } from "@testing-library/react";
import { addDays, format, subDays } from "date-fns";
import { afterEach,beforeEach, describe, expect, it, vi } from "vitest";

import { useTimelineFilters } from "../useTimelineFilters";

// Helper to create mock timeline data
function createMockEntry(overrides: Partial<TimelineEntry>): TimelineEntry {
  return {
    id: "test-id",
    date: format(new Date(), "yyyy-MM-dd"),
    type: "planned",
    status: "planned",
    focus: "Test Focus",
    mainWorkout: "Test Workout",
    accessory: null,
    notes: null,
    ...overrides,
  };
}

describe("useTimelineFilters", () => {
  beforeEach(() => {
    // Set a fixed date for deterministic testing: 2023-10-15
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2023-10-15T12:00:00Z"));
    // Reset URL between tests since filterStatus persists to ?status=...
    globalThis.window?.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should return default state initially", () => {
    const { result } = renderHook(() => useTimelineFilters([]));

    expect(result.current.filterStatus).toBe("all");
    expect(result.current.showAllPast).toBe(false);
    expect(result.current.showAllFuture).toBe(false);
    expect(result.current.filteredTimeline).toEqual([]);
    expect(result.current.pastGroups).toEqual([]);
    expect(result.current.futureGroups).toEqual([]);
    expect(result.current.visiblePastGroups).toEqual([]);
    expect(result.current.visibleFutureGroups).toEqual([]);
    expect(result.current.hiddenPastCount).toBe(0);
    expect(result.current.hiddenFutureCount).toBe(0);
  });

  it("should filter timeline by status", () => {
    const mockData = [
      createMockEntry({ id: "1", status: "completed" }),
      createMockEntry({ id: "2", status: "planned" }),
      createMockEntry({ id: "3", status: "skipped" }),
    ];

    const { result } = renderHook(() => useTimelineFilters(mockData));

    // Initially 'all'
    expect(result.current.filteredTimeline).toHaveLength(3);

    // Filter by completed
    act(() => {
      result.current.setFilterStatus("completed");
    });
    expect(result.current.filteredTimeline).toHaveLength(1);
    expect(result.current.filteredTimeline[0].id).toBe("1");

    // Filter by planned
    act(() => {
      result.current.setFilterStatus("planned");
    });
    expect(result.current.filteredTimeline).toHaveLength(1);
    expect(result.current.filteredTimeline[0].id).toBe("2");
  });

  it("should group and sort dates correctly (past descending, future ascending)", () => {
    const todayStr = "2023-10-15";
    const pastStr1 = "2023-10-14";
    const pastStr2 = "2023-10-10";
    const futureStr1 = "2023-10-16";
    const futureStr2 = "2023-10-20";

    const mockData = [
      createMockEntry({ id: "1", date: pastStr2 }),
      createMockEntry({ id: "2", date: futureStr2 }),
      createMockEntry({ id: "3", date: todayStr }),
      createMockEntry({ id: "4", date: pastStr1 }),
      createMockEntry({ id: "5", date: futureStr1 }),
    ];

    const { result } = renderHook(() => useTimelineFilters(mockData));

    // Past should be strictly less than today, sorted descending (newest past first)
    // Actually, in the code, allGroups is sorted descending (`b < a ? -1 : (b > a ? 1 : 0)`).
    // past = allGroups.filter(([date]) => date < today) -> keeps descending order
    expect(result.current.pastGroups.map(([date]) => date)).toEqual([pastStr1, pastStr2]);

    // Future should be >= today, and the code calls .reverse() on it, so it becomes ascending
    expect(result.current.futureGroups.map(([date]) => date)).toEqual([todayStr, futureStr1, futureStr2]);
  });

  it("should handle pagination for visible groups", () => {
    // Generate 10 past days and 10 future days
    const mockData: TimelineEntry[] = [];

    // 10 past days
    for (let i = 1; i <= 10; i++) {
      const date = format(subDays(new Date("2023-10-15"), i), "yyyy-MM-dd");
      mockData.push(createMockEntry({ id: `past-${i}`, date }));
    }

    // 10 future days (including today as future)
    for (let i = 0; i <= 9; i++) {
      const date = format(addDays(new Date("2023-10-15"), i), "yyyy-MM-dd");
      mockData.push(createMockEntry({ id: `future-${i}`, date }));
    }

    const { result } = renderHook(() => useTimelineFilters(mockData));

    // Initial state: should show max 7
    expect(result.current.pastGroups).toHaveLength(10);
    expect(result.current.visiblePastGroups).toHaveLength(7);
    expect(result.current.hiddenPastCount).toBe(3);

    expect(result.current.futureGroups).toHaveLength(10);
    expect(result.current.visibleFutureGroups).toHaveLength(7);
    expect(result.current.hiddenFutureCount).toBe(3);

    // Show all past
    act(() => {
      result.current.setShowAllPast(true);
    });
    expect(result.current.visiblePastGroups).toHaveLength(10);
    expect(result.current.hiddenPastCount).toBe(0);

    // Show all future
    act(() => {
      result.current.setShowAllFuture(true);
    });
    expect(result.current.visibleFutureGroups).toHaveLength(10);
    expect(result.current.hiddenFutureCount).toBe(0);
  });
});
