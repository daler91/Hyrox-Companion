import { describe, expect, it } from "vitest";

import { buildGeneratePlanInput, getGeneratePlanFormValidation } from "./useGeneratePlanForm";

describe("generate plan form helpers", () => {
  it("requires a goal before step 0 can proceed", () => {
    expect(
      getGeneratePlanFormValidation({
        goal: " ",
        daysPerWeek: 5,
        restDays: ["Saturday", "Sunday"],
      }).canProceedStep0,
    ).toBe(false);
  });

  it("requires the matching number of rest days", () => {
    expect(
      getGeneratePlanFormValidation({
        goal: "Race prep",
        daysPerWeek: 5,
        restDays: ["Sunday"],
      }).canProceedStep1,
    ).toBe(false);
    expect(
      getGeneratePlanFormValidation({
        goal: "Race prep",
        daysPerWeek: 5,
        restDays: ["Saturday", "Sunday"],
      }).canProceedStep1,
    ).toBe(true);
  });

  it("omits optional fields when they are blank", () => {
    expect(
      buildGeneratePlanInput({
        goal: "Race prep",
        totalWeeks: 8,
        daysPerWeek: 7,
        experienceLevel: "intermediate",
        raceDate: "",
        startDate: "",
        restDays: [],
        focusAreas: [],
        injuries: "",
      }),
    ).toEqual({
      goal: "Race prep",
      totalWeeks: 8,
      daysPerWeek: 7,
      experienceLevel: "intermediate",
    });
  });
});
