import { addDaysToISODate } from "@shared/dateUtils";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  buildGeneratePlanInput,
  DEFAULT_WEEKS,
  getGeneratePlanFormValidation,
  useGeneratePlanForm,
} from "./useGeneratePlanForm";

// A valid 8-week span reused across the date-aware validation cases.
const VALID_START = "2026-05-04";
const VALID_END = "2026-06-29";

describe("generate plan form helpers", () => {
  it("requires a goal before step 0 can proceed", () => {
    expect(
      getGeneratePlanFormValidation({
        goal: " ",
        daysPerWeek: 5,
        restDays: ["Saturday", "Sunday"],
        startDate: VALID_START,
        endDate: VALID_END,
      }).canProceedStep0,
    ).toBe(false);
  });

  it("requires the matching number of rest days", () => {
    expect(
      getGeneratePlanFormValidation({
        goal: "Race prep",
        daysPerWeek: 5,
        restDays: ["Sunday"],
        startDate: VALID_START,
        endDate: VALID_END,
      }).canProceedStep1,
    ).toBe(false);
    expect(
      getGeneratePlanFormValidation({
        goal: "Race prep",
        daysPerWeek: 5,
        restDays: ["Saturday", "Sunday"],
        startDate: VALID_START,
        endDate: VALID_END,
      }).canProceedStep1,
    ).toBe(true);
  });

  it("rejects an end date that is on or before the start date", () => {
    const validation = getGeneratePlanFormValidation({
      goal: "Race prep",
      daysPerWeek: 5,
      restDays: ["Saturday", "Sunday"],
      startDate: VALID_END,
      endDate: VALID_START,
    });
    expect(validation.canProceedStep1).toBe(false);
    expect(validation.dateError).toMatch(/after the start date/);
  });

  it("rejects a span outside the 1–24 week range", () => {
    const validation = getGeneratePlanFormValidation({
      goal: "Race prep",
      daysPerWeek: 5,
      restDays: ["Saturday", "Sunday"],
      startDate: "2026-01-01",
      endDate: "2027-01-01",
    });
    expect(validation.canProceedStep1).toBe(false);
    expect(validation.dateError).toMatch(/between 1 and 24 weeks/);
  });

  it("accepts a valid in-range span", () => {
    const validation = getGeneratePlanFormValidation({
      goal: "Race prep",
      daysPerWeek: 5,
      restDays: ["Saturday", "Sunday"],
      startDate: VALID_START,
      endDate: VALID_END,
    });
    expect(validation.canProceedStep1).toBe(true);
    expect(validation.dateError).toBeNull();
  });

  it("omits blank optional fields, but always sends injuries", () => {
    // injuries is deliberately NOT omitted when empty: the server treats its
    // presence as authoritative and an empty string clears the athlete's
    // remembered constraints. Omitting it would make "I cleared the box"
    // indistinguishable from "this client never sends the field", so a resolved
    // injury could never be forgotten.
    expect(
      buildGeneratePlanInput({
        goal: "Race prep",
        daysPerWeek: 7,
        experienceLevel: "intermediate",
        startDate: VALID_START,
        endDate: VALID_END,
        endDateIsRaceDate: true,
        restDays: [],
        focusAreas: [],
        injuries: "",
      }),
    ).toEqual({
      goal: "Race prep",
      daysPerWeek: 7,
      experienceLevel: "intermediate",
      startDate: VALID_START,
      endDate: VALID_END,
      endDateIsRaceDate: true,
      injuries: "",
    });
  });

  it("prefills the injuries box from the athlete's remembered constraints", () => {
    const { result } = renderHook(() =>
      useGeneratePlanForm({ initialConstraints: "Bad left knee" }),
    );

    expect(result.current.injuries).toBe("Bad left knee");
  });

  it("re-seeds the remembered constraints on reset rather than blanking them", () => {
    const { result } = renderHook(() =>
      useGeneratePlanForm({ initialConstraints: "Bad left knee" }),
    );

    act(() => result.current.setInjuries("Something else"));
    act(() => result.current.resetForm());

    expect(result.current.injuries).toBe("Bad left knee");
  });

  it("uses and resets onboarding initial values", () => {
    const initialStartDate = "2026-05-15";
    const expectedEndDate = addDaysToISODate(initialStartDate, DEFAULT_WEEKS * 7);
    const { result } = renderHook(() =>
      useGeneratePlanForm({
        initialGoal: "Functional fitness",
        initialStartDate,
      }),
    );

    expect(result.current.goal).toBe("Functional fitness");
    expect(result.current.startDate).toBe(initialStartDate);
    expect(result.current.endDate).toBe(expectedEndDate);
    expect(result.current.endDateIsRaceDate).toBe(true);
    expect(result.current.planWeeks).toBe(DEFAULT_WEEKS);
    expect(result.current.canGenerate).toBe(true);

    act(() => {
      result.current.setGoal("Changed");
      result.current.setStartDate("");
      result.current.setEndDateIsRaceDate(false);
      result.current.resetForm();
    });

    expect(result.current.goal).toBe("Functional fitness");
    expect(result.current.startDate).toBe(initialStartDate);
    expect(result.current.endDate).toBe(expectedEndDate);
    expect(result.current.endDateIsRaceDate).toBe(true);
  });
});
