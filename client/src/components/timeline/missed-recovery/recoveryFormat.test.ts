import { describe, expect, it } from "vitest";

import {
  describeDay,
  describeKept,
  formatDayChip,
  formatLoadChange,
  formatMinutes,
  formatWeekLabel,
  weekContains,
} from "./recoveryFormat";

const TODAY = "2026-09-24"; // a Thursday

describe("recovery sheet wording", () => {
  it("formats minutes", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(135)).toBe("2h 15m");
  });

  it("names candidate days relative to today", () => {
    expect(formatDayChip("2026-09-24", TODAY)).toBe("Today");
    expect(formatDayChip("2026-09-25", TODAY)).toBe("Tomorrow");
    expect(formatDayChip("2026-09-27", TODAY)).toBe("Sun 27 Sep");
  });

  it("names weeks relative to today", () => {
    expect(formatWeekLabel("2026-09-21", TODAY)).toBe("This week");
    expect(formatWeekLabel("2026-09-14", TODAY)).toBe("Last week");
    expect(formatWeekLabel("2026-09-28", TODAY)).toBe("Next week");
    expect(formatWeekLabel("2026-10-05", TODAY)).toBe("Week of 5 Oct");
    expect(weekContains("2026-09-21", "2026-09-27")).toBe(true);
    expect(weekContains("2026-09-21", "2026-09-28")).toBe(false);
  });

  it("reads a load change as a signed percentage", () => {
    expect(formatLoadChange({ loadBefore: 200, loadAfter: 224 })).toBe("+12%");
    expect(formatLoadChange({ loadBefore: 200, loadAfter: 152 })).toBe("−24%");
    expect(formatLoadChange({ loadBefore: 200, loadAfter: 200 })).toBe("unchanged");
    expect(formatLoadChange({ loadBefore: 0, loadAfter: 80 })).toBe("new load");
  });

  it("describes what is already on a day", () => {
    expect(describeDay([])).toBe("Free");
    expect(describeDay([{ focus: "Easy run", priority: "optional", durationMin: 40, status: "planned" }])).toBe(
      "Easy run",
    );
    expect(describeDay([{ focus: "Strength", priority: "key", durationMin: 60, status: "completed" }])).toBe(
      "Strength (done)",
    );
  });

  it("says how much of the session an option keeps", () => {
    expect(describeKept(1, 50, 50)).toBe("Keeps all of it (50 min)");
    expect(describeKept(0.6, 30, 50)).toBe("Keeps about 60% (30 min of 50 min)");
    expect(describeKept(0, 0, 50)).toBe("Drops it (50 min)");
  });
});
