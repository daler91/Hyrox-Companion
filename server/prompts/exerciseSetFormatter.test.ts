import { describe, expect, it } from "vitest";

import {
  buildWorkoutSearchText,
  formatExerciseSetsForPrompt,
  type PromptExerciseSet,
} from "./exerciseSetFormatter";

// Shared literals (hoisted to keep the suite DRY and avoid duplicated-string smells).
const BACK_SQUAT = "back_squat";
const BACK_SQUAT_LABEL = "Back Squat";
const PULL_UP = "pull_up";
const PULL_UP_LABEL = "Pull-ups";
const CUSTOM = "custom";
const LEG_DAY = "Leg Day";

function set(overrides: Partial<PromptExerciseSet> = {}): PromptExerciseSet {
  return {
    exerciseName: BACK_SQUAT,
    ...overrides,
  };
}

describe("formatExerciseSetsForPrompt", () => {
  describe("empty / nullish input", () => {
    it("returns an empty string for null", () => {
      expect(formatExerciseSetsForPrompt(null)).toBe("");
    });

    it("returns an empty string for undefined", () => {
      expect(formatExerciseSetsForPrompt(undefined)).toBe("");
    });

    it("returns an empty string for an empty array", () => {
      expect(formatExerciseSetsForPrompt([])).toBe("");
    });
  });

  describe("single set rendering", () => {
    it("renders just the label when there are no measurements", () => {
      expect(formatExerciseSetsForPrompt([set()])).toBe(BACK_SQUAT_LABEL);
    });

    it("renders reps as the raw value (reps bypass formatNumber)", () => {
      expect(formatExerciseSetsForPrompt([set({ reps: 12 })])).toBe(`${BACK_SQUAT_LABEL}: 12 reps`);
    });

    it("renders every measurement part in a fixed order", () => {
      const result = formatExerciseSetsForPrompt([
        set({ reps: 10, weight: 60, distance: 100, time: 5, notes: "deep" }),
      ]);
      expect(result).toBe(`${BACK_SQUAT_LABEL}: 10 reps, 60 kg, 100m, 5 min, note: deep`);
    });

    it("keeps zero-valued measurements because 0 is not null", () => {
      const result = formatExerciseSetsForPrompt([
        set({ reps: 0, weight: 0, distance: 0, time: 0 }),
      ]);
      expect(result).toBe(`${BACK_SQUAT_LABEL}: 0 reps, 0 kg, 0m, 0 min`);
    });

    it("trims notes and renders them", () => {
      expect(formatExerciseSetsForPrompt([set({ notes: "  felt strong  " })])).toBe(
        `${BACK_SQUAT_LABEL}: note: felt strong`,
      );
    });

    it("drops whitespace-only notes (and renders just the label)", () => {
      expect(formatExerciseSetsForPrompt([set({ notes: "   " })])).toBe(BACK_SQUAT_LABEL);
    });
  });

  describe("number formatting", () => {
    it("renders integers without a decimal point", () => {
      expect(formatExerciseSetsForPrompt([set({ weight: 60 })])).toBe(`${BACK_SQUAT_LABEL}: 60 kg`);
    });

    it("renders fractional weights with trimmed decimals", () => {
      expect(formatExerciseSetsForPrompt([set({ weight: 62.5 })])).toBe(
        `${BACK_SQUAT_LABEL}: 62.5 kg`,
      );
    });

    it("renders fractional distances", () => {
      expect(formatExerciseSetsForPrompt([set({ distance: 1.5 })])).toBe(
        `${BACK_SQUAT_LABEL}: 1.5m`,
      );
    });

    it("renders fractional times", () => {
      expect(formatExerciseSetsForPrompt([set({ time: 7.5 })])).toBe(
        `${BACK_SQUAT_LABEL}: 7.5 min`,
      );
    });

    it("strips trailing zeros introduced by toFixed (0.1 stays 0.1)", () => {
      expect(formatExerciseSetsForPrompt([set({ weight: 0.1 })])).toBe(
        `${BACK_SQUAT_LABEL}: 0.1 kg`,
      );
    });
  });

  describe("units", () => {
    it("defaults weight to kg", () => {
      expect(formatExerciseSetsForPrompt([set({ weight: 60 })])).toBe(`${BACK_SQUAT_LABEL}: 60 kg`);
    });

    it("honours a weight-unit override", () => {
      expect(formatExerciseSetsForPrompt([set({ weight: 60 })], { weightUnit: "lbs" })).toBe(
        `${BACK_SQUAT_LABEL}: 60 lbs`,
      );
    });

    it("falls back to kg when the weight unit is an empty string", () => {
      expect(formatExerciseSetsForPrompt([set({ weight: 60 })], { weightUnit: "" })).toBe(
        `${BACK_SQUAT_LABEL}: 60 kg`,
      );
    });

    it("defaults distance to metres", () => {
      expect(formatExerciseSetsForPrompt([set({ distance: 400 })])).toBe(
        `${BACK_SQUAT_LABEL}: 400m`,
      );
    });

    it("uses feet only when the distance unit is exactly 'miles'", () => {
      expect(formatExerciseSetsForPrompt([set({ distance: 400 })], { distanceUnit: "miles" })).toBe(
        `${BACK_SQUAT_LABEL}: 400ft`,
      );
    });

    it("uses metres for any non-'miles' distance unit (e.g. km)", () => {
      expect(formatExerciseSetsForPrompt([set({ distance: 400 })], { distanceUnit: "km" })).toBe(
        `${BACK_SQUAT_LABEL}: 400m`,
      );
    });
  });

  describe("collapsing identical sets", () => {
    it("collapses multiple identical sets into 'N sets x ...'", () => {
      const sets = [set({ reps: 10, weight: 60 }), set({ reps: 10, weight: 60 })];
      expect(formatExerciseSetsForPrompt(sets)).toBe(
        `${BACK_SQUAT_LABEL}: 2 sets x 10 reps, 60 kg`,
      );
    });

    it("collapses to just 'N sets' when there are no measurements", () => {
      expect(formatExerciseSetsForPrompt([set(), set()])).toBe(`${BACK_SQUAT_LABEL}: 2 sets`);
    });

    it("treats notes that differ only by whitespace as identical (collapses)", () => {
      const sets = [set({ reps: 5, notes: "go" }), set({ reps: 5, notes: "go " })];
      expect(formatExerciseSetsForPrompt(sets)).toBe(
        `${BACK_SQUAT_LABEL}: 2 sets x 5 reps, note: go`,
      );
    });
  });

  describe("enumerating non-collapsible sets", () => {
    it("enumerates sets that differ by reps", () => {
      const sets = [set({ setNumber: 1, reps: 10 }), set({ setNumber: 2, reps: 12 })];
      expect(formatExerciseSetsForPrompt(sets)).toBe(
        `${BACK_SQUAT_LABEL}: set 1: 10 reps; set 2: 12 reps`,
      );
    });

    it("does not collapse when only the notes differ", () => {
      const sets = [
        set({ setNumber: 1, reps: 5, notes: "easy" }),
        set({ setNumber: 2, reps: 5, notes: "hard" }),
      ];
      expect(formatExerciseSetsForPrompt(sets)).toBe(
        `${BACK_SQUAT_LABEL}: set 1: 5 reps, note: easy; set 2: 5 reps, note: hard`,
      );
    });

    it("uses '?' for a missing set number", () => {
      const sets = [set({ setNumber: null, reps: 10 }), set({ setNumber: null, reps: 12 })];
      expect(formatExerciseSetsForPrompt(sets)).toBe(
        `${BACK_SQUAT_LABEL}: set ?: 10 reps; set ?: 12 reps`,
      );
    });

    it("omits the colon for an enumerated set with no measurements", () => {
      const sets = [set({ setNumber: 1, reps: 10 }), set({ setNumber: 2 })];
      expect(formatExerciseSetsForPrompt(sets)).toBe(`${BACK_SQUAT_LABEL}: set 1: 10 reps; set 2`);
    });

    it("uses '?' for an enumerated set that has neither a set number nor measurements", () => {
      const sets = [
        set({ sortOrder: 0, setNumber: 1, reps: 10 }),
        set({ sortOrder: 1, setNumber: null }),
      ];
      expect(formatExerciseSetsForPrompt(sets)).toBe(`${BACK_SQUAT_LABEL}: set 1: 10 reps; set ?`);
    });
  });

  describe("grouping and ordering", () => {
    it("groups only consecutive same-name sets (non-adjacent ones split into separate groups)", () => {
      const sets = [
        set({ exerciseName: BACK_SQUAT, sortOrder: 0, reps: 5 }),
        set({ exerciseName: PULL_UP, sortOrder: 1, reps: 10 }),
        set({ exerciseName: BACK_SQUAT, sortOrder: 2, reps: 8 }),
      ];
      expect(formatExerciseSetsForPrompt(sets)).toBe(
        `${BACK_SQUAT_LABEL}: 5 reps | ${PULL_UP_LABEL}: 10 reps | ${BACK_SQUAT_LABEL}: 8 reps`,
      );
    });

    it("merges adjacent same-name identical sets after sorting", () => {
      const sets = [
        set({ exerciseName: BACK_SQUAT, sortOrder: 1, reps: 5, weight: 100 }),
        set({ exerciseName: BACK_SQUAT, sortOrder: 0, reps: 5, weight: 100 }),
      ];
      expect(formatExerciseSetsForPrompt(sets)).toBe(
        `${BACK_SQUAT_LABEL}: 2 sets x 5 reps, 100 kg`,
      );
    });

    it("sorts by sortOrder first", () => {
      const sets = [
        set({ sortOrder: 2, setNumber: 3, reps: 30 }),
        set({ sortOrder: 1, setNumber: 2, reps: 20 }),
        set({ sortOrder: 0, setNumber: 1, reps: 10 }),
      ];
      expect(formatExerciseSetsForPrompt(sets)).toBe(
        `${BACK_SQUAT_LABEL}: set 1: 10 reps; set 2: 20 reps; set 3: 30 reps`,
      );
    });

    it("breaks sortOrder ties with setNumber", () => {
      const sets = [
        set({ sortOrder: 0, setNumber: 2, reps: 20 }),
        set({ sortOrder: 0, setNumber: 1, reps: 10 }),
      ];
      expect(formatExerciseSetsForPrompt(sets)).toBe(
        `${BACK_SQUAT_LABEL}: set 1: 10 reps; set 2: 20 reps`,
      );
    });
  });

  describe("exercise label resolution", () => {
    it("maps a known exercise name to its canonical label", () => {
      expect(formatExerciseSetsForPrompt([set({ exerciseName: PULL_UP, reps: 8 })])).toBe(
        `${PULL_UP_LABEL}: 8 reps`,
      );
    });

    it("echoes an unknown exercise name verbatim", () => {
      expect(formatExerciseSetsForPrompt([set({ exerciseName: "made_up_move", reps: 5 })])).toBe(
        "made_up_move: 5 reps",
      );
    });

    it("uses the custom label for a custom exercise", () => {
      const sets = [set({ exerciseName: CUSTOM, customLabel: "Sumo Deadlift", reps: 5 })];
      expect(formatExerciseSetsForPrompt(sets)).toBe("Sumo Deadlift: 5 reps");
    });

    it("falls back to the 'Custom' definition label when a custom exercise has no label", () => {
      expect(formatExerciseSetsForPrompt([set({ exerciseName: CUSTOM, reps: 5 })])).toBe(
        "Custom: 5 reps",
      );
    });

    it("strips the 'custom:' prefix from the exercise name", () => {
      expect(
        formatExerciseSetsForPrompt([set({ exerciseName: "custom:Sled Drag", reps: 5 })]),
      ).toBe("Sled Drag: 5 reps");
    });

    it("keeps a bogus-looking label for a custom exercise", () => {
      const sets = [set({ exerciseName: CUSTOM, customLabel: "3x", reps: 5 })];
      expect(formatExerciseSetsForPrompt(sets)).toBe("3x: 5 reps");
    });

    it("ignores a bogus 'NxX' label on a known exercise and uses the canonical label", () => {
      const sets = [set({ exerciseName: BACK_SQUAT, customLabel: "3x", reps: 5 })];
      expect(formatExerciseSetsForPrompt(sets)).toBe(`${BACK_SQUAT_LABEL}: 5 reps`);
    });

    it("ignores a pure-number label on a known exercise", () => {
      const sets = [set({ exerciseName: BACK_SQUAT, customLabel: "10", reps: 5 })];
      expect(formatExerciseSetsForPrompt(sets)).toBe(`${BACK_SQUAT_LABEL}: 5 reps`);
    });

    it("keeps a label that only resembles a number ('5kg' is not bogus)", () => {
      const sets = [set({ exerciseName: BACK_SQUAT, customLabel: "5kg", reps: 5 })];
      expect(formatExerciseSetsForPrompt(sets)).toBe("5kg: 5 reps");
    });

    it("keeps a descriptive label ('10 reps' is not bogus)", () => {
      const sets = [set({ exerciseName: BACK_SQUAT, customLabel: "10 reps", reps: 5 })];
      expect(formatExerciseSetsForPrompt(sets)).toBe("10 reps: 5 reps");
    });
  });
});

describe("buildWorkoutSearchText", () => {
  it("prepends focus and uses the structured exercise summary when details exist", () => {
    const result = buildWorkoutSearchText({ focus: LEG_DAY, exerciseDetails: [set({ reps: 5 })] });
    expect(result).toBe(`${LEG_DAY} Exercises: ${BACK_SQUAT_LABEL}: 5 reps`);
  });

  it("prefers exercise details over the free-text main workout", () => {
    const result = buildWorkoutSearchText({
      focus: "Legs",
      mainWorkout: "ignored when details are present",
      exerciseDetails: [set({ reps: 5 })],
    });
    expect(result).toBe(`Legs Exercises: ${BACK_SQUAT_LABEL}: 5 reps`);
  });

  it("falls back to main/accessory/notes when there are no exercise details", () => {
    const result = buildWorkoutSearchText({
      focus: LEG_DAY,
      mainWorkout: "Squats",
      accessory: "Calf raise",
      notes: "tough",
    });
    expect(result).toBe(`${LEG_DAY} Squats Calf raise tough`);
  });

  it("falls back to free text when exercise details are an empty array", () => {
    const result = buildWorkoutSearchText({ focus: LEG_DAY, exerciseDetails: [] });
    expect(result).toBe(LEG_DAY);
  });

  it("returns a single field when it is the only one present", () => {
    expect(buildWorkoutSearchText({ mainWorkout: "Easy run" })).toBe("Easy run");
  });

  it("filters out whitespace-only fields", () => {
    expect(buildWorkoutSearchText({ focus: "   ", mainWorkout: "Run" })).toBe("Run");
  });

  it("returns an empty string when every field is empty", () => {
    expect(buildWorkoutSearchText({})).toBe("");
  });
});
