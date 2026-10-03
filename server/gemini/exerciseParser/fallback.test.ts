import { SET_NUMBER_MAX } from "@shared/schema";
import { describe, expect, it } from "vitest";

import { HEURISTIC_FALLBACK_MAX_SETS, heuristicFallbackRowsFromText } from "./fallback";

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

// S1 (CODEBASE_ANALYSIS_2026-10-03): the set count read from athlete text used
// to be unbounded, and one set object was built per set — so a few characters
// ("Back squat 10000000 x 5") blocked the event loop or ran the heap out.
describe("heuristicFallbackRowsFromText (set-count bound)", () => {
  it("accepts a set count at the set-number ceiling", () => {
    const [row] = rows(`Back Squat ${SET_NUMBER_MAX}x5`);
    expect(row.sets).toHaveLength(SET_NUMBER_MAX);
    expect(row.sets[SET_NUMBER_MAX - 1]).toMatchObject({ setNumber: SET_NUMBER_MAX, reps: 5 });
  });

  it("does not read a number above the set-number ceiling as a set count", () => {
    expect(rows(`Back Squat ${SET_NUMBER_MAX + 1}x5`)).toHaveLength(0);
    expect(rows(`Squat: ${SET_NUMBER_MAX + 1} x 5`)).toHaveLength(0);
  });

  it.each([
    "Back squat 10000000 x 5",
    "Back squat: 30000000 x 5",
    "Back squat 99999999999999999999 x 5",
  ])("returns fast, bounded output for %j", (text) => {
    const started = performance.now();
    const parsed = rows(text);
    expect(performance.now() - started).toBeLessThan(250);
    expect(parsed).toHaveLength(0);
  });

  it("keeps the other lines of a paste when one has an absurd set count", () => {
    const parsed = rows("Back squat 10000000 x 5\nDeadlift 3 x 5");
    expect(parsed).toHaveLength(1);
    expect(parsed[0].exerciseName).toBe("deadlift");
    expect(parsed[0].sets).toHaveLength(3);
  });

  // A reparse hands the fallback the stored mainWorkout + accessory (~100k
  // characters), and every 8 characters here is another SET_NUMBER_MAX sets.
  it("bounds the total sets of a long paste", () => {
    const text = `a ${SET_NUMBER_MAX}x1;`.repeat(12_375); // 99,000 characters
    const started = performance.now();
    const parsed = rows(text);
    expect(performance.now() - started).toBeLessThan(250);
    const totalSets = parsed.reduce((sum, row) => sum + row.sets.length, 0);
    // Past the cap, so the write path still rejects it rather than saving a
    // truncated workout — but by at most one row.
    expect(totalSets).toBeGreaterThan(HEURISTIC_FALLBACK_MAX_SETS);
    expect(totalSets).toBeLessThanOrEqual(HEURISTIC_FALLBACK_MAX_SETS + SET_NUMBER_MAX);
  });

  it("keeps every row of a paste up to the set cap", () => {
    const lines = HEURISTIC_FALLBACK_MAX_SETS / 10;
    const parsed = rows(Array.from({ length: lines }, () => "Deadlift 10 x 5").join("\n"));
    expect(parsed).toHaveLength(lines);
    expect(parsed.reduce((sum, row) => sum + row.sets.length, 0)).toBe(HEURISTIC_FALLBACK_MAX_SETS);
  });
});
