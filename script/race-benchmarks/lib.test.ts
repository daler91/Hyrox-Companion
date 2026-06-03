import { describe, expect, it } from "vitest";

import { HYROX_STATION_ORDER } from "../../shared/raceConstants";
import { aggregate, MIN_COHORT_SAMPLE, parseClockToSeconds, parseRaceRow, percentile } from "./lib";

function clock(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

// A clean, internally-consistent singles row builder.
function validRow(overrides: Record<string, string> = {}): Record<string, string> {
  const runs = [300, 310, 320, 330, 340, 350, 360, 370]; // run_1..8 (all ≥ floor, fatiguing)
  const stations = [270, 180, 240, 200, 240, 120, 200, 300]; // work_1..8 in station order, ≥ floors
  const transitions = [30, 30, 30, 30, 30, 30, 30, 0]; // roxzone_1..8 (last 0)
  const total = [...runs, ...stations, ...transitions].reduce((t, x) => t + x, 0);
  const row: Record<string, string> = {
    division: "open",
    gender: "male",
    age_group: "30-34",
    total_time: clock(total),
  };
  runs.forEach((v, i) => (row[`run_${i + 1}`] = clock(v)));
  stations.forEach((v, i) => (row[`work_${i + 1}`] = clock(v)));
  transitions.forEach((v, i) => (row[`roxzone_${i + 1}`] = clock(v)));
  return { ...row, ...overrides };
}

describe("parseClockToSeconds", () => {
  it("parses H:MM:SS and M:SS", () => {
    expect(parseClockToSeconds("0:59:07")).toBe(3547);
    expect(parseClockToSeconds("0:03:12")).toBe(192);
    expect(parseClockToSeconds("5:30")).toBe(330);
  });
  it("rejects junk", () => {
    expect(parseClockToSeconds("")).toBeNull();
    expect(parseClockToSeconds("abc")).toBeNull();
    expect(parseClockToSeconds("12")).toBeNull();
  });
});

describe("parseRaceRow", () => {
  it("accepts a clean singles row and maps work_N to station order", () => {
    const parsed = parseRaceRow(validRow());
    expect(parsed).not.toBeNull();
    expect(parsed!.division).toBe("open");
    expect(parsed!.ageBand).toBe("30-34");
    expect(parsed!.stationSeconds).toHaveLength(8);
    expect(parsed!.stationSeconds[0]).toBe(270); // work_1 = skierg
    expect(parsed!.transitionTotal).toBe(210);
  });

  it("drops non-singles formats and non male/female genders", () => {
    expect(parseRaceRow(validRow({ division: "doubles" }))).toBeNull();
    expect(parseRaceRow(validRow({ division: "relay" }))).toBeNull();
    expect(parseRaceRow(validRow({ gender: "mixed" }))).toBeNull();
  });

  it("drops impossible splits below the world-class floor", () => {
    expect(parseRaceRow(validRow({ work_1: "0:30" }))).toBeNull(); // 30s skierg < 180 floor
    expect(parseRaceRow(validRow({ run_1: "1:00" }))).toBeNull(); // 60s/km < 165 floor
  });

  it("drops rows whose segments don't add up to the total", () => {
    expect(parseRaceRow(validRow({ total_time: "2:30:00" }))).toBeNull();
  });

  it("normalizes coarse/blank age groups to null (roll-up only)", () => {
    expect(parseRaceRow(validRow({ age_group: "30-39" }))!.ageBand).toBeNull();
    expect(parseRaceRow(validRow({ age_group: "" }))!.ageBand).toBeNull();
  });
});

describe("percentile", () => {
  it("interpolates linearly", () => {
    expect(percentile([10, 20, 30, 40], 50)).toBe(25);
    expect(percentile([10, 20, 30, 40], 0)).toBe(10);
    expect(percentile([10, 20, 30, 40], 100)).toBe(40);
  });
});

describe("aggregate", () => {
  it("always emits the division×gender roll-up but gates thin age cohorts", () => {
    const base = parseRaceRow(validRow())!;
    const races = [
      ...Array.from({ length: MIN_COHORT_SAMPLE + 5 }, () => base), // 30-34 clears the gate
      parseRaceRow(validRow({ age_group: "55-59" }))!, // a single 55-59 row → dropped as age cohort
    ];
    const { benchmarks, rankings } = aggregate(races);

    expect(benchmarks["open|male"]).toBeDefined(); // roll-up always present
    expect(benchmarks["open|male"].runLegP50Seconds).toHaveLength(8);
    expect(benchmarks["open|male"].stationP50Seconds[HYROX_STATION_ORDER[0]]).toBe(270);
    expect(rankings["open|male"].finishSecondsByPercentile).toHaveLength(99);

    expect(benchmarks["open|male|30-34"]).toBeDefined(); // cleared the sample gate
    expect(benchmarks["open|male|55-59"]).toBeUndefined(); // below the gate
  });
});
