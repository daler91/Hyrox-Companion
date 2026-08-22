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
      // Null, not 0: a fresh athlete has no completion rate, and 0% reads as
      // total failure rather than "nothing has come due yet" (audit M5).
      completionRate: null,
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
    it("scores only days that have finished, excluding today", () => {
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

      // INVERTED (audit M5). This asserted 67% — 2 of 3 counting TODAY. The
      // window was `<= today`, so a session the athlete still had all evening
      // to do was already scored against them and opening the app in the
      // morning dropped their rate. Today is now excluded symmetrically: the
      // day is not scored at all until it is over, so this is 1 of 2 elapsed
      // days = 50%. Counting today's completion but not today's shortfall
      // would inflate the numerator against a denominator that ignored it.
      expect(stats.completionRate).toBe(50);
    });

    it("returns null when nothing has come due yet", () => {
      const timeline: Partial<TimelineEntry>[] = [
        { date: "2024-05-16", status: "completed" }, // Future
      ];

      const stats = calculateStatsFor(timeline);

      expect(stats.completionRate).toBeNull();
    });

    it("does not count a declared absence as a failure", () => {
      const timeline: Partial<TimelineEntry>[] = [
        { date: "2024-05-13", status: "completed" },
        // Injured; the timeline already refuses to show these as missed.
        { date: "2024-05-14", status: "planned", excused: true },
        { date: "2024-05-14", status: "missed", excused: true },
      ];

      const stats = calculateStatsFor(timeline);

      // 1 of 1 elapsed, unexcused day. Counting the absence would report 33%.
      expect(stats.completionRate).toBe(100);
    });
  });

});
