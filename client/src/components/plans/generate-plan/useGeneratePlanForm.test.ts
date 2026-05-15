import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  buildGeneratePlanInput,
  getGeneratePlanFormValidation,
  useGeneratePlanForm,
} from "./useGeneratePlanForm";

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

  it("requires start date only when requested by onboarding", () => {
    expect(
      getGeneratePlanFormValidation(
        {
          goal: "Race prep",
          daysPerWeek: 5,
          restDays: ["Saturday", "Sunday"],
          startDate: "",
        },
        { requireStartDate: true },
      ).canProceedStep1,
    ).toBe(false);
    expect(
      getGeneratePlanFormValidation(
        {
          goal: "Race prep",
          daysPerWeek: 5,
          restDays: ["Saturday", "Sunday"],
          startDate: "2026-05-15",
        },
        { requireStartDate: true },
      ).canProceedStep1,
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

  it("uses and resets onboarding initial values", () => {
    const { result } = renderHook(() =>
      useGeneratePlanForm({
        initialGoal: "Functional fitness",
        initialStartDate: "2026-05-15",
        requireStartDate: true,
      }),
    );

    expect(result.current.goal).toBe("Functional fitness");
    expect(result.current.startDate).toBe("2026-05-15");
    expect(result.current.canGenerate).toBe(true);

    act(() => {
      result.current.setGoal("Changed");
      result.current.setStartDate("");
      result.current.resetForm();
    });

    expect(result.current.goal).toBe("Functional fitness");
    expect(result.current.startDate).toBe("2026-05-15");
  });
});
