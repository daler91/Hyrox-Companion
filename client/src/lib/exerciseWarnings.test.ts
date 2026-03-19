import { describe, it, expect } from "vitest";
import { getMissingFieldWarnings, getExerciseMissingFields } from "./exerciseWarnings";
import type { StructuredExercise } from "@/components/ExerciseInput";

describe("exerciseWarnings", () => {
  describe("getMissingFieldWarnings", () => {
    it("should return an empty array if all required fields are present", () => {
      const exercise: StructuredExercise = {
        exerciseName: "back_squat",
        category: "strength",
        sets: [
          { setNumber: 1, reps: 10, weight: 100 },
          { setNumber: 2, reps: 8, weight: 110 },
        ],
      };
      const warnings = getMissingFieldWarnings(exercise);
      expect(warnings).toEqual([]);
    });

    it("should return an empty array if there are no sets", () => {
      const exercise: StructuredExercise = {
        exerciseName: "back_squat",
        category: "strength",
        sets: [],
      };
      const warnings = getMissingFieldWarnings(exercise);
      expect(warnings).toEqual([]);
    });

    it("should warn about missing weight and reps for strength exercises", () => {
      const exercise: StructuredExercise = {
        exerciseName: "back_squat",
        category: "strength",
        sets: [
          { setNumber: 1, reps: undefined, weight: undefined },
        ],
      };
      const warnings = getMissingFieldWarnings(exercise);
      expect(warnings).toContain("Back Squat is missing weight");
      expect(warnings).toContain("Back Squat is missing reps");
      expect(warnings).toHaveLength(2);
    });

    it("should not warn if only some sets are missing a field but others have it", () => {
      // The `isFieldMissing` function returns true ONLY if *every* set is missing the field.
      // So if at least one set has the field, it shouldn't warn.
      const exercise: StructuredExercise = {
        exerciseName: "back_squat",
        category: "strength",
        sets: [
          { setNumber: 1, reps: 10, weight: undefined },
          { setNumber: 2, reps: 8, weight: 110 },
        ],
      };
      const warnings = getMissingFieldWarnings(exercise);
      expect(warnings).toEqual([]);
    });

    it("should warn about missing time for hyrox_station exercises", () => {
      const exercise: StructuredExercise = {
        exerciseName: "skierg",
        category: "hyrox_station",
        sets: [
          { setNumber: 1, distance: 1000, time: undefined },
        ],
      };
      const warnings = getMissingFieldWarnings(exercise);
      expect(warnings).toContain("SkiErg is missing time");
      expect(warnings).toHaveLength(1);
    });

    it("should warn about missing distance and time for running exercises", () => {
      const exercise: StructuredExercise = {
        exerciseName: "easy_run",
        category: "running",
        sets: [
          { setNumber: 1, distance: undefined, time: undefined },
        ],
      };
      const warnings = getMissingFieldWarnings(exercise);
      expect(warnings).toContain("Easy Run is missing distance");
      expect(warnings).toContain("Easy Run is missing time");
      expect(warnings).toHaveLength(2);
    });

    it("should use customLabel for custom exercises in warning messages", () => {
      const exercise: StructuredExercise = {
        exerciseName: "custom",
        category: "strength",
        customLabel: "My Custom Lift",
        sets: [
          { setNumber: 1, reps: undefined, weight: undefined },
        ],
      };
      const warnings = getMissingFieldWarnings(exercise);
      expect(warnings).toContain("My Custom Lift is missing weight");
      expect(warnings).toContain("My Custom Lift is missing reps");
      expect(warnings).toHaveLength(2);
    });

    it("should default to conditioning category for custom exercises with no category, warning about reps", () => {
      const exercise: StructuredExercise = {
        // Explicitly casting to StructuredExercise with missing category to test fallback
        exerciseName: "custom",
        category: "", // will fall back to conditioning
        customLabel: "Weird Exercise",
        sets: [
          { setNumber: 1, reps: undefined },
        ],
      } as StructuredExercise;

      const warnings = getMissingFieldWarnings(exercise);
      expect(warnings).toContain("Weird Exercise is missing reps");
      expect(warnings).toHaveLength(1);
    });

    it("should fallback to display name for custom exercises without customLabel", () => {
      const exercise: StructuredExercise = {
        exerciseName: "custom",
        category: "strength",
        sets: [
          { setNumber: 1, reps: undefined, weight: undefined },
        ],
      };
      const warnings = getMissingFieldWarnings(exercise);
      expect(warnings).toContain("Custom is missing weight");
      expect(warnings).toContain("Custom is missing reps");
      expect(warnings).toHaveLength(2);
    });
  });

  describe("getExerciseMissingFields", () => {
    it("should return the labels of the missing fields", () => {
      const exercise: StructuredExercise = {
        exerciseName: "easy_run",
        category: "running",
        sets: [
          { setNumber: 1, distance: undefined, time: undefined },
        ],
      };
      const missingFields = getExerciseMissingFields(exercise);
      expect(missingFields).toContain("Distance");
      expect(missingFields).toContain("Time");
      expect(missingFields).toHaveLength(2);
    });

    it("should return an empty array if no fields are missing", () => {
      const exercise: StructuredExercise = {
        exerciseName: "easy_run",
        category: "running",
        sets: [
          { setNumber: 1, distance: 5000, time: 1800 },
        ],
      };
      const missingFields = getExerciseMissingFields(exercise);
      expect(missingFields).toEqual([]);
    });
  });
});
