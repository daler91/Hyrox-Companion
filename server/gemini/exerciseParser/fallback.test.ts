import { describe, expect, it } from "vitest";

import { heuristicFallbackRowsFromText } from "./fallback";

type FallbackRow = {
  exerciseName: string;
  category: string;
  customLabel?: string;
  sets: Array<Record<string, unknown>>;
};

const rows = (text: string): FallbackRow[] => heuristicFallbackRowsFromText(text) as FallbackRow[];

describe("heuristicFallbackRowsFromText (single-measurement / circuit lines)", () => {
  it("parses a measurement-first run line into a distance set", () => {
    const [row] = rows("1000m Run");
    expect(row.exerciseName).toBe("run_1k");
    expect(row.category).toBe("running");
    expect(row.sets).toHaveLength(1);
    expect(row.sets[0]).toMatchObject({ setNumber: 1, distance: 1000, distanceUnit: "m" });
  });

  it("parses a bare-number station line into a reps set", () => {
    const [row] = rows("100 Wall Balls");
    expect(row.exerciseName).toBe("wall_balls");
    expect(row.category).toBe("functional");
    expect(row.sets[0]).toMatchObject({ setNumber: 1, reps: 100 });
  });

  it("parses a name-first line with a weight unit into a weight set", () => {
    const [row] = rows("Deadlift 100kg");
    expect(row.exerciseName).toBe("deadlift");
    expect(row.category).toBe("strength");
    expect(row.sets[0]).toMatchObject({ setNumber: 1, weight: 100, weightUnit: "kg" });
  });

  it("resolves erg/run aliases the shared normalizer misses", () => {
    expect(rows("1000m Row")[0].exerciseName).toBe("rowing");
    expect(rows("1000m Ski Erg")[0].exerciseName).toBe("skierg");
    expect(rows("1km Run")[0].exerciseName).toBe("run_1k");
  });

  it("strips leading list markers before parsing", () => {
    expect(rows("1) 1000m Run")[0].exerciseName).toBe("run_1k");
    expect(rows("- 50m Sled Push")[0].exerciseName).toBe("sled_push");
  });

  it("handles a 'name: measurement' lead", () => {
    const [row] = rows("SkiErg: 1000m");
    expect(row.exerciseName).toBe("skierg");
    expect(row.sets[0]).toMatchObject({ distance: 1000, distanceUnit: "m" });
  });

  it("ignores prose lines that do not map to a known exercise", () => {
    expect(rows("Rest 90 seconds")).toHaveLength(0);
    expect(rows("Total time was great today")).toHaveLength(0);
  });

  it("recovers one row per line of a full Hyrox circuit", () => {
    const hyrox = [
      "1000m Run",
      "1000m SkiErg",
      "50m Sled Push",
      "50m Sled Pull",
      "80m Burpee Broad Jump",
      "1000m Row",
      "200m Farmers Carry",
      "100m Sandbag Lunges",
      "100 Wall Balls",
    ].join("\n");

    expect(rows(hyrox)).toHaveLength(9);
  });

  it("still parses the existing sets x reps shape", () => {
    const [row] = rows("Back Squat 3x5");
    expect(row.exerciseName).toBe("back_squat");
    expect(row.sets).toHaveLength(3);
    expect(row.sets[0]).toMatchObject({ setNumber: 1, reps: 5 });
  });
});
