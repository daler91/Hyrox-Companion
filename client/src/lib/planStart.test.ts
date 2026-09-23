import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { aiWeekOneStartNote, defaultPlanStartDate, weekOneStartNote } from "./planStart";

describe("plan start helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("defaults to the next Monday, or today on a Monday", () => {
    vi.setSystemTime(new Date(2026, 8, 23, 12)); // Wednesday 23 Sep 2026, local
    expect(defaultPlanStartDate()).toBe("2026-09-28");
    vi.setSystemTime(new Date(2026, 8, 28, 8)); // Monday
    expect(defaultPlanStartDate()).toBe("2026-09-28");
  });

  it("explains what a midweek start leaves off the calendar, and nothing for a Monday", () => {
    expect(weekOneStartNote("2026-09-28")).toBeNull();
    expect(weekOneStartNote("2026-09-24")).toBe(
      "Plans run Monday to Sunday, so starting on a Thursday leaves week 1's Monday to Wednesday sessions off your calendar. Pick a Monday to keep them.",
    );
    expect(weekOneStartNote("2026-09-22")).toContain("week 1's Monday sessions");
  });

  it("tells an AI plan's athlete the early days become rest", () => {
    expect(aiWeekOneStartNote("2026-09-28")).toBeNull();
    expect(aiWeekOneStartNote("2026-09-23")).toBe(
      "Week 1 starts on a Wednesday, so the plan keeps Monday and Tuesday of that week as rest.",
    );
  });
});
