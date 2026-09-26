import { describe, expect, it } from "vitest";

import { classifyRunPurpose, gradingIntentFor } from "./sessionIntent";

function purposeOf(focus: string, mainWorkout = "", exerciseNames: string[] = []) {
  return classifyRunPurpose({ focus, mainWorkout, exerciseNames }).purpose;
}

describe("classifyRunPurpose", () => {
  it("reads the title first", () => {
    expect(purposeOf("Threshold Run")).toBe("threshold");
    expect(purposeOf("Tempo Run")).toBe("threshold");
    expect(purposeOf("Cruise intervals")).toBe("threshold");
    expect(purposeOf("Easy Run + strides")).toBe("easy");
    expect(purposeOf("Zone 2 run")).toBe("easy");
    expect(purposeOf("Recovery Run")).toBe("recovery");
    expect(purposeOf("Long Run")).toBe("long");
    expect(purposeOf("VO2 Intervals")).toBe("intervals");
    expect(purposeOf("Hill Repeats")).toBe("intervals");
    expect(purposeOf("Hyrox Sim")).toBe("race");
    expect(purposeOf("Race Day")).toBe("race");
    expect(purposeOf("Steady run")).toBe("steady");
  });

  it("calls threshold intervals a threshold session, not intervals", () => {
    expect(purposeOf("Threshold Intervals")).toBe("threshold");
  });

  it("does not grade a rest day", () => {
    expect(classifyRunPurpose({ focus: "Rest", mainWorkout: "Complete rest" })).toEqual({
      purpose: null,
      source: null,
      reason: null,
      hardFinishMinutes: null,
    });
  });

  it("falls back to the exercise keys when the title is generic, most intense first", () => {
    expect(purposeOf("Run", "", ["easy_run", "tempo_run"])).toBe("threshold");
    expect(purposeOf("Running", "", ["easy_run"])).toBe("easy");
    expect(purposeOf("Cardio", "", ["interval_run"])).toBe("intervals");
    expect(classifyRunPurpose({ focus: "Run", exerciseNames: ["recovery_run"] }).source).toBe("exercise");
  });

  it("lets the title outrank an exercise key parsed from the reps", () => {
    // A threshold session's reps are sometimes parsed as interval_run.
    expect(purposeOf("Threshold Run", "", ["interval_run"])).toBe("threshold");
  });

  it("reads the prescription last, with threshold words beating the easy warm-up", () => {
    expect(purposeOf("Wednesday session", "15 min easy, 3 x 10 min threshold, 10 min easy")).toBe("threshold");
    expect(purposeOf("Wednesday session", "15 min easy, 6 x 800 m hard, 10 min easy")).toBe("intervals");
    expect(purposeOf("Monday", "5km easy run at conversational pace")).toBe("easy");
    // Easy words about something other than running say nothing.
    expect(purposeOf("Accessories", "easy core circuit")).toBeNull();
  });

  it("leaves a long run's measurable hard finish out, and refuses one it cannot measure", () => {
    const measured = classifyRunPurpose({
      focus: "Long Run",
      mainWorkout: "16 km easy @ 6:05-6:40/km, last 15 min @ 5:10/km",
    });
    expect(measured).toMatchObject({ purpose: "long", hardFinishMinutes: 15 });
    expect(purposeOf("Long Run", "18 km progression run")).toBe("steady");
    expect(purposeOf("Long run with tempo finish")).toBe("steady");
  });

  it("gives a reason the grade card can show", () => {
    expect(classifyRunPurpose({ focus: "Tempo Run" }).reason).toMatch(/titled/);
    expect(classifyRunPurpose({ focus: "Run", exerciseNames: ["easy_run"] }).reason).toMatch(/exercises/);
  });
});

describe("gradingIntentFor", () => {
  it("grades easy, recovery and long runs as easy, and threshold as threshold", () => {
    expect(gradingIntentFor("easy")).toBe("easy");
    expect(gradingIntentFor("recovery")).toBe("easy");
    expect(gradingIntentFor("long")).toBe("easy");
    expect(gradingIntentFor("threshold")).toBe("threshold");
  });

  it("does not grade intervals, steady or race efforts yet", () => {
    expect(gradingIntentFor("intervals")).toBeNull();
    expect(gradingIntentFor("steady")).toBeNull();
    expect(gradingIntentFor("race")).toBeNull();
    expect(gradingIntentFor(null)).toBeNull();
  });
});
