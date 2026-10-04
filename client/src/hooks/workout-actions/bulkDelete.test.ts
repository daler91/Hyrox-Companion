import type { TimelineEntry } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { buildBulkDeleteWorkoutTargets } from "./bulkDelete";

function makeEntry(overrides: Partial<TimelineEntry>): TimelineEntry {
  return { id: "1", date: "2026-01-01", status: "planned", planDayId: null, workoutLogId: null, ...overrides } as TimelineEntry;
}

describe("buildBulkDeleteWorkoutTargets", () => {
  // A completed planned session carries both ids. Sending its plan day
  // deleted only the prescription; the log survived (plan_day_id is ON DELETE
  // SET NULL) and came back as an unplanned workout. Its log goes, as with the
  // single delete, and the server re-syncs the plan day to planned or missed.
  // CL23 (CODEBASE_ANALYSIS_2026-10-03)
  it("deletes the log of a completed planned session, not its plan day", () => {
    const completedPlanned = makeEntry({ id: "pd-1", status: "completed", planDayId: "pd-1", workoutLogId: "wl-1" });

    expect(buildBulkDeleteWorkoutTargets([completedPlanned])).toEqual({
      workoutLogIds: ["wl-1"],
      planDayIds: [],
    });
  });

  it("deletes the plan day of an entry with no log", () => {
    const planned = makeEntry({ id: "pd-1", status: "planned", planDayId: "pd-1" });
    const skipped = makeEntry({ id: "pd-2", status: "skipped", planDayId: "pd-2" });
    const missed = makeEntry({ id: "pd-3", status: "missed", planDayId: "pd-3" });

    expect(buildBulkDeleteWorkoutTargets([planned, skipped, missed])).toEqual({
      workoutLogIds: [],
      planDayIds: ["pd-1", "pd-2", "pd-3"],
    });
  });

  it("splits a mixed selection and sends each id once", () => {
    const unplanned = makeEntry({ id: "wl-1", status: "completed", workoutLogId: "wl-1" });
    const planned = makeEntry({ id: "pd-1", status: "planned", planDayId: "pd-1" });
    const completedPlanned = makeEntry({ id: "pd-2", status: "completed", planDayId: "pd-2", workoutLogId: "wl-2" });

    expect(buildBulkDeleteWorkoutTargets([unplanned, planned, completedPlanned, unplanned])).toEqual({
      workoutLogIds: ["wl-1", "wl-2"],
      planDayIds: ["pd-1"],
    });
  });
});
