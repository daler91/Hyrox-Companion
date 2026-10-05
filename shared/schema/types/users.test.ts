import { describe, expect, it } from "vitest";

import { updateUserPreferencesSchema } from "./users";

// C50 (CODEBASE_ANALYSIS_2026-10-03): weekly_goal is an integer column, and a
// fractional goal came back from Postgres as a 500 instead of a 400.
describe("updateUserPreferencesSchema weeklyGoal", () => {
  it.each([1, 5, 14])("takes a goal of %i sessions", (weeklyGoal) => {
    expect(updateUserPreferencesSchema.safeParse({ weeklyGoal }).success).toBe(true);
  });

  it.each([4.5, 0, 15])("refuses a goal of %d sessions", (weeklyGoal) => {
    const result = updateUserPreferencesSchema.safeParse({ weeklyGoal });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["weeklyGoal"]);
  });
});
