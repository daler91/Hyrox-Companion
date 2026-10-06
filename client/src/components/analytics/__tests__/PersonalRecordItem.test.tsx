import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PersonalRecordItem } from "../PersonalRecordItem";

type RecordRow = Parameters<typeof PersonalRecordItem>[0]["pr"];

function record(overrides: Partial<RecordRow>): RecordRow {
  return {
    exerciseName: "skierg",
    customLabel: null,
    category: "functional",
    maxWeight: null,
    maxWeightDate: null,
    maxDistance: null,
    maxDistanceDate: null,
    bestTime: null,
    bestTimeDate: null,
    estimated1RM: null,
    estimated1RMDate: null,
    ...overrides,
  };
}

// CL35 (CODEBASE_ANALYSIS_2026-10-03): the stored minutes were printed raw
// with a "min" suffix, so a 3:46 row read "3.7666667min".
describe("PersonalRecordItem", () => {
  it("reads a best time as a clock rather than fractional minutes", () => {
    render(
      <PersonalRecordItem pr={record({ bestTime: 3 + 46 / 60 })} weightLabel="kg" dLabel="m" />,
    );

    expect(screen.getByTestId("text-pr-time-skierg")).toHaveTextContent(/^3:46$/);
  });

  it("reads a sub-minute hold in seconds on the clock", () => {
    render(
      <PersonalRecordItem
        pr={record({ exerciseName: "plank", bestTime: 0.75 })}
        weightLabel="kg"
        dLabel="m"
      />,
    );

    expect(screen.getByTestId("text-pr-time-plank")).toHaveTextContent(/^0:45$/);
  });

  it("keeps the units on weight, distance and e1RM, without float noise", () => {
    render(
      <PersonalRecordItem
        pr={record({
          exerciseName: "back_squat",
          category: "strength",
          maxWeight: 220.46226218,
          maxDistance: 1000,
          estimated1RM: 250.1,
        })}
        weightLabel="lbs"
        dLabel="ft"
      />,
    );

    expect(screen.getByTestId("text-pr-weight-back_squat")).toHaveTextContent(/^220\.46lbs$/);
    expect(screen.getByTestId("text-pr-distance-back_squat")).toHaveTextContent(/^1000ft$/);
    expect(screen.getByTestId("text-pr-e1rm-back_squat")).toHaveTextContent(/^250\.1lbs e1RM$/);
  });
});
