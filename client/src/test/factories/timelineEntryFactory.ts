import type { TimelineEntry } from "@shared/schema";

/**
 * Shared `TimelineEntry` fixture for the fuelling component specs. Defaults to
 * a planned strength day; pass overrides to tweak any field.
 */
export function makeTimelineEntry(overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    id: "entry-1",
    date: "2026-06-09",
    type: "planned",
    status: "planned",
    focus: "Strength",
    mainWorkout: "5x5 squat",
    accessory: null,
    notes: null,
    planDayId: "day-1",
    ...overrides,
  };
}
