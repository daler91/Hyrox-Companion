import { describe, expect, it } from "vitest";

import { updateWorkoutRouteSchema } from "./shared";

describe("workout route schema heart-rate consistency", () => {
  it("rejects a max heart rate below the average when both are present", () => {
    const result = updateWorkoutRouteSchema.safeParse({ avgHeartrate: 180, maxHeartrate: 150 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((issue) => issue.path.includes("maxHeartrate"))).toBe(true);
  });

  it("accepts max >= avg, equal values, or a single side", () => {
    expect(updateWorkoutRouteSchema.safeParse({ avgHeartrate: 150, maxHeartrate: 180 }).success).toBe(true);
    expect(updateWorkoutRouteSchema.safeParse({ avgHeartrate: 150, maxHeartrate: 150 }).success).toBe(true);
    expect(updateWorkoutRouteSchema.safeParse({ maxHeartrate: 150 }).success).toBe(true);
    expect(updateWorkoutRouteSchema.safeParse({ avgHeartrate: 150 }).success).toBe(true);
  });
});
