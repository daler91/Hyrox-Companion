import { describe, expect, it } from "vitest";

import {
  getRaceReference,
  HYROX_STATION_ORDER,
  RACE_REFERENCE,
  RACE_SEGMENTS,
  resolveRaceReference,
  RUN_EXERCISE_NAME,
  TOTAL_STATIONS,
} from "./raceSpec";

describe("RACE_SEGMENTS", () => {
  it("describes the 16-segment course as 8 runs interleaved with 8 stations", () => {
    expect(RACE_SEGMENTS).toHaveLength(16);
    expect(RACE_SEGMENTS.filter((s) => s.kind === "run")).toHaveLength(8);
    expect(RACE_SEGMENTS.filter((s) => s.kind === "station")).toHaveLength(TOTAL_STATIONS);
  });

  it("starts with a run and alternates run, station, …", () => {
    RACE_SEGMENTS.forEach((segment, i) => {
      expect(segment.index).toBe(i + 1);
      expect(segment.kind).toBe(i % 2 === 0 ? "run" : "station");
    });
  });

  it("places the stations in the official HYROX order", () => {
    const stations = RACE_SEGMENTS.filter((s) => s.kind === "station").map((s) => s.exerciseName);
    expect(stations).toEqual([...HYROX_STATION_ORDER]);
  });

  it("uses the canonical run exercise key for every run leg", () => {
    for (const run of RACE_SEGMENTS.filter((s) => s.kind === "run")) {
      expect(run.exerciseName).toBe(RUN_EXERCISE_NAME);
    }
  });
});

describe("RACE_REFERENCE", () => {
  it("covers all four division × gender combinations with loaded-station weights", () => {
    for (const division of ["open", "pro"] as const) {
      for (const gender of ["male", "female"] as const) {
        const ref = RACE_REFERENCE[division][gender];
        expect(ref.runKmBenchmarkSeconds).toBeGreaterThan(0);
        for (const station of ["sled_push", "sled_pull", "farmers_carry", "sandbag_lunges", "wall_balls"] as const) {
          expect(ref.stations[station].loadKg).toBeGreaterThan(0);
        }
        // Erg stations have no external load.
        expect(ref.stations.skierg.loadKg).toBeUndefined();
        expect(ref.stations.rowing.loadKg).toBeUndefined();
      }
    }
  });

  it("makes Pro loads heavier than Open for the same gender", () => {
    expect(RACE_REFERENCE.pro.male.stations.sled_push.loadKg!).toBeGreaterThan(
      RACE_REFERENCE.open.male.stations.sled_push.loadKg!,
    );
    expect(RACE_REFERENCE.pro.female.stations.wall_balls.loadKg!).toBeGreaterThan(
      RACE_REFERENCE.open.female.stations.wall_balls.loadKg!,
    );
  });
});

describe("resolveRaceReference", () => {
  it("resolves an explicit division + gender without assuming", () => {
    const resolved = resolveRaceReference("pro", "female");
    expect(resolved.division).toBe("pro");
    expect(resolved.resolvedGender).toBe("female");
    expect(resolved.genderAssumed).toBe(false);
    expect(resolved.reference).toBe(getRaceReference("pro", "female"));
  });

  it("defaults an unknown division to open", () => {
    expect(resolveRaceReference("something-else", "male").division).toBe("open");
    expect(resolveRaceReference(null, "male").division).toBe("open");
  });

  it("uses a blended, gender-assumed reference when gender is withheld", () => {
    for (const gender of ["prefer_not_to_say", null, undefined] as const) {
      const resolved = resolveRaceReference("open", gender);
      expect(resolved.genderAssumed).toBe(true);
      expect(resolved.resolvedGender).toBeNull();
      // Blended benchmark = mean of male/female.
      const male = getRaceReference("open", "male");
      const female = getRaceReference("open", "female");
      expect(resolved.reference.runKmBenchmarkSeconds).toBe(
        Math.round((male.runKmBenchmarkSeconds + female.runKmBenchmarkSeconds) / 2),
      );
      // Conservative (heavier, male) load standard.
      expect(resolved.reference.stations.sled_push.loadKg).toBe(male.stations.sled_push.loadKg);
    }
  });
});
