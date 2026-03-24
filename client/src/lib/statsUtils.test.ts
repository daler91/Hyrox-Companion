import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { calculateStats } from "./statsUtils";
import type { TimelineEntry } from "@shared/schema";

// Set a fixed date for testing: May 15, 2024 is a Wednesday.
// This means the start of the week (Sunday) is May 12, 2024.
// End of the week (Saturday) is May 18, 2024.
const MOCK_TODAY = new Date("2024-05-15T12:00:00Z");

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
      currentStreak: 0,
    });
  });

  describe("weekly stats (workoutsThisWeek, completedThisWeek)", () => {
    it("should count entries within the current week correctly", () => {
      const timeline: Partial<TimelineEntry>[] = [
        // Out of week (before)
        { date: "2024-05-11", status: "completed" },
        // In week
        { date: "2024-05-12", status: "completed" }, // Sunday, start of week
        { date: "2024-05-14", status: "planned" }, // Tuesday
        { date: "2024-05-16", status: "missed" }, // Thursday
        { date: "2024-05-18", status: "completed" }, // Saturday, end of week
        // Out of week (after)
        { date: "2024-05-19", status: "planned" },
      ];

      const stats = calculateStats(timeline as TimelineEntry[]);

      expect(stats.workoutsThisWeek).toBe(4); // 12th, 14th, 16th, 18th
      expect(stats.completedThisWeek).toBe(2); // 12th, 18th
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

      const stats = calculateStats(timeline as TimelineEntry[]);

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

      const stats = calculateStats(timeline as TimelineEntry[]);

      // 2 completed out of 3 total (past + today)
      expect(stats.completionRate).toBe(Math.round((2 / 3) * 100));
    });

    it("should return 0 when there are no past or today entries", () => {
      const timeline: Partial<TimelineEntry>[] = [
        { date: "2024-05-16", status: "completed" }, // Future
      ];

      const stats = calculateStats(timeline as TimelineEntry[]);

      expect(stats.completionRate).toBe(0);
    });
  });

  describe("current streak (currentStreak)", () => {
    it("should count consecutive days backwards from today", () => {
      const timeline: Partial<TimelineEntry>[] = [
        { date: "2024-05-15", status: "completed" }, // Today
        { date: "2024-05-14", status: "completed" }, // Yesterday
        { date: "2024-05-13", status: "completed" }, // Day before yesterday
      ];

      const stats = calculateStats(timeline as TimelineEntry[]);
      expect(stats.currentStreak).toBe(3);
    });

    it("should count streak even if today is not completed but yesterday was", () => {
      const timeline: Partial<TimelineEntry>[] = [
        { date: "2024-05-14", status: "completed" }, // Yesterday
        { date: "2024-05-13", status: "completed" }, // Day before yesterday
        { date: "2024-05-12", status: "completed" }, // 3 days ago
      ];

      const stats = calculateStats(timeline as TimelineEntry[]);
      expect(stats.currentStreak).toBe(3);
    });

    it("should break streak if a day is missed", () => {
      const timeline: Partial<TimelineEntry>[] = [
        { date: "2024-05-15", status: "completed" }, // Today
        { date: "2024-05-14", status: "completed" }, // Yesterday
        // 2024-05-13 is missing/missed
        { date: "2024-05-12", status: "completed" }, // 3 days ago
      ];

      const stats = calculateStats(timeline as TimelineEntry[]);
      expect(stats.currentStreak).toBe(2);
    });

    it("should count multiple completed entries on the same day as 1 day for streak", () => {
      const timeline: Partial<TimelineEntry>[] = [
        { date: "2024-05-15", status: "completed" },
        { date: "2024-05-15", status: "completed" },
        { date: "2024-05-14", status: "completed" },
      ];

      const stats = calculateStats(timeline as TimelineEntry[]);
      expect(stats.currentStreak).toBe(2);
    });

    it("should return 0 streak if neither today nor yesterday has a completed entry", () => {
      const timeline: Partial<TimelineEntry>[] = [
        { date: "2024-05-13", status: "completed" }, // 2 days ago
      ];

      const stats = calculateStats(timeline as TimelineEntry[]);
      expect(stats.currentStreak).toBe(0);
    });
  });
});
