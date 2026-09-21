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
    ["Rest!!", ""],
    ["Complete rest.!.", ""],
  ])("treats focus %j / workout %j as a rest day", (focus, mainWorkout) => {
    expect(isRestLikePlanDay(focus, mainWorkout)).toBe(true);
  });

  it.each([
    ["Recovery run", "40 min easy Z2"],
    ["Rest-pause sets", "5x5 back squat"],
    ["Threshold intervals", "6x800m"],
    ["Long run", "Rest 2 min between reps"],
    ["", ""],
    // Only trailing `.`/`!` come off, and stripping them can't invent a match.
    ["rest!?", ""],
    ["...", ""],
  ])("keeps focus %j / workout %j as a session", (focus, mainWorkout) => {
    expect(isRestLikePlanDay(focus, mainWorkout)).toBe(false);
  });
});
