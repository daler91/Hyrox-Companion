import { describe, expect, it } from "vitest";

import { readWrittenMinutes, readWrittenSessionMinutes } from "./sessionTextDuration";

describe("readWrittenMinutes", () => {
  it.each([
    ["40 min easy", 40],
    ["40min tempo", 40],
    ["Easy Z2 run 40min", 40],
    ["Easy 45 minute run", 45],
    ["Easy run, 45 min", 45],
    ["90 min easy", 90],
    ["20' easy", 20],
    ["45-60 min steady", 53],
    ["45 to 60 minutes easy", 53],
    ["45–60 min steady", 53],
    ["Long run 1h", 60],
    ["1.5 hours easy", 90],
    ["Long run 1h30", 90],
    ["1 h 15 min easy", 75],
    ["1 hour 15 minutes easy ride", 75],
    ["1-1.5 h easy ride", 75],
    ["Tempo 4x5min", 20],
    ["Long run 1:45:00", 105],
    ["Steady 45:00", 45],
  ])("reads %j as %i min", (text, minutes) => {
    expect(readWrittenMinutes(text)).toBe(minutes);
  });

  it("totals the steps, repeats included, and ignores paces", () => {
    // 15 + 3 × (8 + 2) + 10.
    expect(readWrittenMinutes("15 min easy, 3 x 8 min @ 5:04/km with 2 min jog, 10 min easy")).toBe(55);
    // The comma ends the repeat: the 90 s is counted once.
    expect(readWrittenMinutes("Warm up 10 min\n4×5 min @ threshold, 90s easy\nCool down 10 min")).toBe(42);
    expect(readWrittenMinutes("2 x 20 min at 4:30 per km then 10 min easy")).toBe(50);
    expect(readWrittenMinutes("40 min easy + 6 x 20s strides")).toBe(42);
  });

  it("ignores targets that are not lengths: zones, RPE, heart rate, loads, race paces", () => {
    expect(readWrittenMinutes("50 min Z2, RPE 4, under 145 bpm")).toBe(50);
    expect(readWrittenMinutes("3 x 10 min @ 10k pace, 2 min jog")).toBe(32);
    expect(readWrittenMinutes("Week 3: 40 min easy at 70%")).toBe(40);
  });

  it("reads a timed format's clock whatever is done inside it", () => {
    expect(readWrittenMinutes("AMRAP 20 min: 5 pull-ups, 10 push-ups, 15 air squats")).toBe(20);
    expect(readWrittenMinutes("EMOM 12 min: 10 wall balls")).toBe(12);
    expect(readWrittenMinutes("Every 2 min x 10: 250m row")).toBe(20);
    expect(readWrittenMinutes("Every 90 seconds for 15 min: 12 cal row")).toBe(15);
  });

  it("does not read a session with work it gives no time for", () => {
    for (const text of [
      "6x800m at 5k pace with 2 min jog recovery",
      "5 x 1 km at threshold",
      "8 km easy, conversational pace",
      "5k easy run",
      "8.1 km, 45:00",
      "15 min warm-up, 5 x 1 km @ threshold, 10 min cool-down",
      "3x5 Back Squat, 3 min rest",
      "1km run, 100 wall balls, 1km run",
      "Easy run 45 min + 4 x 100m strides",
      "For time: 100 burpees",
    ]) {
      expect(readWrittenMinutes(text), text).toBeNull();
    }
  });

  it("does not read text with no lengths, or lengths too small or large to be the session", () => {
    expect(readWrittenMinutes("Conversational easy aerobic")).toBeNull();
    expect(readWrittenMinutes("Complete rest or light walk")).toBeNull();
    expect(readWrittenMinutes("3 rounds, 90s rest between sets")).toBeNull();
    expect(readWrittenMinutes("Hold 2 min")).toBeNull();
    expect(readWrittenMinutes("Ride 6h")).toBeNull();
    expect(readWrittenMinutes("")).toBeNull();
    expect(readWrittenMinutes(null)).toBeNull();
  });

  it("stays linear on long runs of whitespace", () => {
    const text = `40${" ".repeat(50_000)}x`;
    const started = performance.now();
    expect(readWrittenMinutes(text)).toBeNull();
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("readWrittenSessionMinutes", () => {
  it("reads the main workout, adding the accessory work when it states its minutes", () => {
    expect(readWrittenSessionMinutes({ focus: "Easy run", mainWorkout: "40 min easy", accessory: null })).toBe(40);
    expect(
      readWrittenSessionMinutes({ focus: "Easy run", mainWorkout: "40 min easy", accessory: "Core circuit 15 min" }),
    ).toBe(55);
    expect(
      readWrittenSessionMinutes({ focus: "Easy run", mainWorkout: "40 min easy", accessory: "3x10 lunges" }),
    ).toBe(40);
  });

  it("falls back to the title when the main workout says nothing about time", () => {
    expect(readWrittenSessionMinutes({ focus: "Long run 90 min", mainWorkout: "Conversational pace" })).toBe(90);
    expect(readWrittenSessionMinutes({ focus: "Easy run", mainWorkout: "Conversational pace" })).toBeNull();
  });
});
