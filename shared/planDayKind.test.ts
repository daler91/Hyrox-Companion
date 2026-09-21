import { describe, expect, it } from "vitest";

import { isRestLikePlanDay } from "./planDayKind";

describe("isRestLikePlanDay", () => {
  it.each([
    ["Rest", "Complete rest or light walk"],
    ["rest day", ""],
    ["Active recovery", "Easy walk"],
    ["Off", ""],
    ["Threshold intervals", "Complete rest."],
    ["  RECOVERY  ", "anything"],
  ])("treats focus %j / workout %j as a rest day", (focus, mainWorkout) => {
    expect(isRestLikePlanDay(focus, mainWorkout)).toBe(true);
  });

  it.each([
    ["Recovery run", "40 min easy Z2"],
    ["Rest-pause sets", "5x5 back squat"],
    ["Threshold intervals", "6x800m"],
    ["Long run", "Rest 2 min between reps"],
    ["", ""],
  ])("keeps focus %j / workout %j as a session", (focus, mainWorkout) => {
    expect(isRestLikePlanDay(focus, mainWorkout)).toBe(false);
  });

  it("strips a trailing run of stops, and only those", () => {
    expect(isRestLikePlanDay("Rest!!", "")).toBe(true);
    expect(isRestLikePlanDay("Complete rest.!.", "")).toBe(true);
    expect(isRestLikePlanDay("rest!?", "")).toBe(false); // a `?` is not a stop
    expect(isRestLikePlanDay("...", "")).toBe(false); // stripping cannot invent a match
  });
});
