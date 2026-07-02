import { describe, expect, it } from "vitest";

import type { PendingMutation } from "./offlineQueue";
import {
  buildPendingTimelineEntry,
  isPendingTimelineEntry,
  isPendingWorkoutCreate,
} from "./pendingWorkouts";

function mutation(overrides: Partial<PendingMutation> = {}): PendingMutation {
  return {
    id: "abc",
    method: "POST",
    url: "/api/v1/workouts",
    body: { date: "2026-05-16", focus: "Legs", mainWorkout: "Squats" },
    timestamp: Date.parse("2026-05-16T08:00:00Z"),
    retryCount: 0,
    ...overrides,
  };
}

describe("pendingWorkouts", () => {
  it("recognizes only workout-create mutations", () => {
    expect(isPendingWorkoutCreate(mutation())).toBe(true);
    expect(isPendingWorkoutCreate(mutation({ url: "/api/v1/nutrition/logs" }))).toBe(false);
    expect(isPendingWorkoutCreate(mutation({ method: "PATCH" }))).toBe(false);
  });

  it("builds a synthetic timeline entry flagged pending with the queue id", () => {
    const entry = buildPendingTimelineEntry(mutation());

    expect(entry.id).toBe("pending-abc");
    expect(entry.pending).toBe(true);
    expect(isPendingTimelineEntry(entry)).toBe(true);
    expect(entry.date).toBe("2026-05-16");
    expect(entry.focus).toBe("Legs");
    expect(entry.mainWorkout).toBe("Squats");
    // Unlinked so plan-scoped flows can't target a row that isn't on the server.
    expect(entry.planDayId).toBeNull();
    expect(entry.workoutLogId).toBeNull();
  });

  it("falls back to the enqueue date and a Workout label for a sparse body", () => {
    const entry = buildPendingTimelineEntry(mutation({ body: {} }));
    expect(entry.date).toBe("2026-05-16");
    expect(entry.focus).toBe("Workout");
  });

  it("does not flag a plain server entry as pending", () => {
    const serverEntry = { ...buildPendingTimelineEntry(mutation()), pending: undefined };
    expect(isPendingTimelineEntry(serverEntry)).toBe(false);
  });
});
