import { describe, expect, it } from "vitest";

import { generateSummary } from "./workoutSummary";

describe("generateSummary", () => {
  it("writes uniform sets as sets x reps with the weight, and mixed ones as a set count", () => {
    const uniform = [{ reps: 5, weight: 100 }, { reps: 5, weight: 100 }, { reps: 5, weight: 100 }];
    expect(generateSummary([{ exerciseName: "back_squat", sets: uniform }], "kg", "km")).toBe("Back Squat: 3x5, 100kg");
    expect(generateSummary([{ exerciseName: "back_squat", sets: [{ reps: 5, weight: 100 }, { reps: 3, weight: 110 }] }], "kg", "km")).toBe(
      "Back Squat: 2 sets, 5 reps",
    );
  });

  it("writes distance and time in the athlete's units", () => {
    expect(generateSummary([{ exerciseName: "easy_run", sets: [{ distance: 5000, time: 30 }] }], "kg", "km")).toBe("Easy Run: 5000 m, 30min");
    // 16,404 ft is a clean 5 km.
    expect(generateSummary([{ exerciseName: "easy_run", sets: [{ distance: 16404 }] }], "lbs", "miles")).toBe("Easy Run: 5000 m");
  });

  it("names a custom exercise by its label, and one with nothing logged as completed", () => {
    expect(
      generateSummary(
        [
          { exerciseName: "custom", customLabel: "Tyre flips", sets: [] },
          { exerciseName: "wall_balls", sets: [{ reps: 20 }, { reps: 20 }] },
        ],
        "kg",
        "km",
      ),
    ).toBe("Tyre flips: completed; Wall Balls: 2x20");
    // Not an exercise of the catalogue's own, so by its name.
    expect(generateSummary([{ exerciseName: "constructor", sets: [{}] }], "kg", "km")).toBe("constructor: completed");
  });

  it("lists each step once any set carries a cue", () => {
    expect(
      generateSummary([{ exerciseName: "rowing", sets: [{ distance: 500, notes: "hold 1:50" }, { distance: 500, notes: null }] }], "kg", "km"),
    ).toBe("Rowing: 2 sets, 500 m [S1(cue: hold 1:50) -> S2]");
  });

  it("writes an exercise sent without a sets array as completed, with no step list beside a cued one", () => {
    expect(generateSummary([{ exerciseName: "wall_balls", sets: null }, { exerciseName: "skierg" }], "kg", "km")).toBe(
      "Wall Balls: completed; SkiErg: completed",
    );
    expect(
      generateSummary(
        [
          { exerciseName: "wall_balls", sets: null },
          { exerciseName: "rowing", sets: [{ distance: 500, notes: "hold 1:50" }] },
        ],
        "kg",
        "km",
      ),
    ).toBe("Wall Balls: completed; Rowing: 500 m [S1(cue: hold 1:50)]");
  });
});
