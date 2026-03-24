import { describe, it, expect } from "vitest";
import {
  generateSummary,
  makeBlockId,
  getBlockExerciseName,
  exerciseToPayload,
} from "../useWorkoutEditor";
import type { StructuredExercise } from "@/components/ExerciseInput";

describe("generateSummary", () => {
  it("should handle exercises with no sets", () => {
    const exercises: StructuredExercise[] = [
      {
        exerciseName: "skierg",
        category: "hyrox_station",
        sets: [],
      },
    ];

    expect(generateSummary(exercises, "kg", "km")).toBe("SkiErg: completed");
  });

  it("should format single set with reps", () => {
    const exercises: StructuredExercise[] = [
      {
        exerciseName: "wall_balls",
        category: "hyrox_station",
        sets: [{ setNumber: 1, reps: 15 }],
      },
    ];

    expect(generateSummary(exercises, "kg", "km")).toBe("Wall Balls: 15 reps");
  });

  it("should format multiple sets with identical reps and weight", () => {
    const exercises: StructuredExercise[] = [
      {
        exerciseName: "sandbag_lunges",
        category: "hyrox_station",
        sets: [
          { setNumber: 1, reps: 10, weight: 20 },
          { setNumber: 2, reps: 10, weight: 20 },
          { setNumber: 3, reps: 10, weight: 20 },
        ],
      },
    ];

    expect(generateSummary(exercises, "kg", "km")).toBe("Sandbag Lunges: 3x10, 20kg");
  });

  it("should format multiple sets with different reps/weights as just count", () => {
    const exercises: StructuredExercise[] = [
      {
        exerciseName: "sandbag_lunges",
        category: "hyrox_station",
        sets: [
          { setNumber: 1, reps: 10, weight: 20 },
          { setNumber: 2, reps: 8, weight: 20 },
          { setNumber: 3, reps: 6, weight: 25 },
        ],
      },
    ];

    expect(generateSummary(exercises, "kg", "km")).toBe("Sandbag Lunges: 3 sets, 10 reps");
  });

  it("should handle distance and time", () => {
    const exercises: StructuredExercise[] = [
      {
        exerciseName: "rowing",
        category: "hyrox_station",
        sets: [{ setNumber: 1, distance: 1000, time: 4.5 }],
      },
    ];

    expect(generateSummary(exercises, "kg", "km")).toBe("Rowing: 1000m, 4.5min");
  });

  it("should convert distance labels correctly (mi -> ft)", () => {
    const exercises: StructuredExercise[] = [
      {
        exerciseName: "sled_push",
        category: "hyrox_station",
        sets: [{ setNumber: 1, distance: 50 }],
      },
    ];

    expect(generateSummary(exercises, "lbs", "mi")).toBe("Sled Push: 50ft");
  });

  it("should convert distance labels correctly (km -> m)", () => {
    const exercises: StructuredExercise[] = [
      {
        exerciseName: "sled_push",
        category: "hyrox_station",
        sets: [{ setNumber: 1, distance: 50 }],
      },
    ];

    expect(generateSummary(exercises, "kg", "km")).toBe("Sled Push: 50m");
  });

  it("should format custom exercises with and without labels", () => {
    const exercises: StructuredExercise[] = [
      {
        exerciseName: "custom",
        category: "custom",
        customLabel: "My Special Move",
        sets: [{ setNumber: 1, reps: 10 }],
      },
      {
        exerciseName: "custom",
        category: "custom",
        sets: [{ setNumber: 1, time: 2 }],
      },
    ];

    expect(generateSummary(exercises, "kg", "km")).toBe("My Special Move: 10 reps; Custom: 2min");
  });

  it("should combine multiple exercises separated by semicolons", () => {
    const exercises: StructuredExercise[] = [
      {
        exerciseName: "skierg",
        category: "hyrox_station",
        sets: [{ setNumber: 1, distance: 1000 }],
      },
      {
        exerciseName: "wall_balls",
        category: "hyrox_station",
        sets: [{ setNumber: 1, reps: 20, weight: 14 }],
      },
    ];

    expect(generateSummary(exercises, "kg", "km")).toBe("SkiErg: 1000m; Wall Balls: 20 reps, 14kg");
  });

  it("should format multiple sets with only reps but no weight correctly", () => {
    const exercises: StructuredExercise[] = [
      {
        exerciseName: "burpee_broad_jump",
        category: "hyrox_station",
        sets: [
          { setNumber: 1, reps: 20 },
          { setNumber: 2, reps: 20 },
        ],
      },
    ];
    // allSame is true (undefined weight === undefined weight)
    expect(generateSummary(exercises, "kg", "km")).toBe("Burpee Broad Jump: 2x20");
  });

  it("should format multiple sets without reps or time as just N sets", () => {
    const exercises: StructuredExercise[] = [
      {
        exerciseName: "easy_run",
        category: "running",
        sets: [
          { setNumber: 1, distance: 5000 },
          { setNumber: 2, distance: 5000 },
        ],
      },
    ];
    expect(generateSummary(exercises, "kg", "km")).toBe("Easy Run: 2 sets, 5000m");
  });
});

describe("makeBlockId", () => {
  it("should increment the counter and format the ID correctly", () => {
    const counterRef = { current: 0 };

    const id1 = makeBlockId("exercise", counterRef);
    expect(id1).toBe("exercise__1");
    expect(counterRef.current).toBe(1);

    const id2 = makeBlockId("exercise", counterRef);
    expect(id2).toBe("exercise__2");
    expect(counterRef.current).toBe(2);
  });

  it("should handle empty names correctly", () => {
    const counterRef = { current: 5 };
    const id = makeBlockId("", counterRef);
    expect(id).toBe("__6");
    expect(counterRef.current).toBe(6);
  });

  it("should handle names that already contain underscores", () => {
    const counterRef = { current: 10 };
    const id = makeBlockId("some_complex_name", counterRef);
    expect(id).toBe("some_complex_name__11");
    expect(counterRef.current).toBe(11);
  });
});

describe("getBlockExerciseName", () => {
  it("should extract the base name from a standard block ID", () => {
    expect(getBlockExerciseName("squat__1")).toBe("squat");
  });

  it("should extract the base name even if the name contains underscores", () => {
    expect(getBlockExerciseName("bulgarian_split_squat__2")).toBe("bulgarian_split_squat");
    expect(getBlockExerciseName("some__complex__name__3")).toBe("some__complex__name");
  });

  it('should return "custom" for names starting with "custom:"', () => {
    expect(getBlockExerciseName("custom:my_exercise__1")).toBe("custom");
    expect(getBlockExerciseName("custom:another_one__5")).toBe("custom");
  });

  it("should handle block IDs without the expected double underscore gracefully", () => {
    expect(getBlockExerciseName("squat")).toBe("squat");
    expect(getBlockExerciseName("squat_1")).toBe("squat_1");
  });
});

describe("exerciseToPayload", () => {
  it("should format a valid StructuredExercise with sets containing reps, weight, distance, time, and notes", () => {
    const exercise: StructuredExercise = {
      exerciseName: "custom",
      customLabel: "Custom Workout",
      category: "custom",
      confidence: 90,
      sets: [
        {
          setNumber: 1,
          reps: 10,
          weight: 50,
          distance: 100,
          time: 5,
          notes: "Felt good",
        },
        {
          setNumber: 2,
          reps: 8,
          weight: 55,
          distance: 100,
          time: 5,
        },
      ],
    };

    const payload = exerciseToPayload(exercise);

    expect(payload).toEqual({
      exerciseName: "custom",
      customLabel: "Custom Workout",
      category: "custom",
      confidence: 90,
      sets: [
        {
          setNumber: 1,
          reps: 10,
          weight: 50,
          distance: 100,
          time: 5,
          notes: "Felt good",
        },
        {
          setNumber: 2,
          reps: 8,
          weight: 55,
          distance: 100,
          time: 5,
          notes: undefined,
        },
      ],
    });
  });

  it("should format correctly when sets array is empty", () => {
    const exercise: StructuredExercise = {
      exerciseName: "running",
      category: "running",
      sets: [],
    };

    const payload = exerciseToPayload(exercise);

    expect(payload).toEqual({
      exerciseName: "running",
      customLabel: undefined,
      category: "running",
      confidence: undefined,
      sets: [],
    });
  });

  it("should handle undefined sets gracefully", () => {
    // Need to cast to bypass TypeScript complaining about missing sets property
    // since StructuredExercise interface expects sets to be defined,
    // but the function defensively handles it: `(ex.sets || []).map(...)`
    const exercise = {
      exerciseName: "wall_balls",
      category: "hyrox_station",
      // sets is omitted
    } as unknown as StructuredExercise;

    const payload = exerciseToPayload(exercise);

    expect(payload).toEqual({
      exerciseName: "wall_balls",
      customLabel: undefined,
      category: "hyrox_station",
      confidence: undefined,
      sets: [],
    });
  });
});
