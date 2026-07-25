import type { TimelineEntry } from "@shared/schema";
import { afterEach,beforeEach, describe, expect, it, vi } from "vitest";

import { calculateStats } from "./statsUtils";

// Set a fixed date for testing: May 15, 2024 is a Wednesday.
// Weeks are Monday-start (matching the server), so the start of the week is
// Monday May 13, 2024 and the end of the week is Sunday May 19, 2024.
const MOCK_TODAY = new Date("2024-05-15T12:00:00Z");

function calculateStatsFor(timeline: Partial<TimelineEntry>[]) {
  return calculateStats(timeline as TimelineEntry[]);
}

describe("calculateStats", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(MOCK_TODAY);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should return zeros for an empty timeline", () => {
    const stats = calculateStats([]);
    expect(stats).toEqual({
      workoutsThisWeek: 0,
      completedThisWeek: 0,
      plannedUpcoming: 0,
      completionRate: 0,
    });
  });

  describe("weekly stats (workoutsThisWeek, completedThisWeek)", () => {
    it("should count entries within the current week correctly", () => {
      const timeline: Partial<TimelineEntry>[] = [
        // Out of week (before Monday May 13)
        { date: "2024-05-11", status: "completed" }, // Saturday, prev week
        { date: "2024-05-12", status: "completed" }, // Sunday, prev week
        // In week (Mon May 13 – Sun May 19)
        { date: "2024-05-14", status: "planned" },   // Tuesday
        { date: "2024-05-16", status: "missed" },    // Thursday
        { date: "2024-05-18", status: "completed" }, // Saturday
        { date: "2024-05-19", status: "planned" },   // Sunday, end of week
      ];

      const stats = calculateStatsFor(timeline);

      expect(stats.workoutsThisWeek).toBe(4); // 14th, 16th, 18th, 19th
      expect(stats.completedThisWeek).toBe(1); // 18th
    });
  });

  describe("planned upcoming (plannedUpcoming)", () => {
    it("should count planned entries from today onwards", () => {
      const timeline: Partial<TimelineEntry>[] = [
        // Past
        { date: "2024-05-14", status: "planned" },
        // Today
        { date: "2024-05-15", status: "planned" }, // Counted
        { date: "2024-05-15", status: "completed" }, // Not planned
        // Future
        { date: "2024-05-16", status: "planned" }, // Counted
        { date: "2024-05-20", status: "planned" }, // Counted
      ];

      const stats = calculateStatsFor(timeline);

      expect(stats.plannedUpcoming).toBe(3); // 15th, 16th, 20th
    });
  });

  describe("completion rate (completionRate)", () => {
    it("should calculate correctly based on past and today entries", () => {
      const timeline: Partial<TimelineEntry>[] = [
        // Past
        { date: "2024-05-13", status: "completed" },
        { date: "2024-05-14", status: "missed" },
        // Today
        { date: "2024-05-15", status: "completed" },
        // Future (ignored)
        { date: "2024-05-16", status: "completed" },
        { date: "2024-05-17", status: "planned" },
      ];

      const stats = calculateStatsFor(timeline);

      // 2 completed out of 3 total (past + today)
      expect(stats.completionRate).toBe(Math.round((2 / 3) * 100));
    });

    it("should return 0 when there are no past or today entries", () => {
      const timeline: Partial<TimelineEntry>[] = [
        { date: "2024-05-16", status: "completed" }, // Future
      ];

      const stats = calculateStatsFor(timeline);

      expect(stats.completionRate).toBe(0);
    });
  });

});
