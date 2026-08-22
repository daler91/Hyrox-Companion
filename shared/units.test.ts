import { describe, expect, it } from "vitest";

import { convertDistance, userDistanceToMeters } from "./unitConversion";
import { formatMinutes, METRES_PER_MILE, minutes, minutesToSeconds, seconds, secondsToMinutes, unitless } from "./units";

describe("duration conversions", () => {
  it("round-trips a whole minute", () => {
    expect(unitless(secondsToMinutes(minutesToSeconds(minutes(12))))).toBe(12);
  });

  it("keeps sub-minute durations as fractions rather than rounding to zero", () => {
    // The C7 case: a 45-second step target entering a minutes column.
    expect(unitless(secondsToMinutes(seconds(45)))).toBe(0.75);
    expect(unitless(secondsToMinutes(seconds(30)))).toBe(0.5);
  });

  it("converts a logged session length to canonical seconds", () => {
    // The H1 case: workout_logs.duration (minutes) into MafTestMetrics (seconds).
    expect(unitless(minutesToSeconds(minutes(60)))).toBe(3600);
    expect(unitless(minutesToSeconds(minutes(30)))).toBe(1800);
  });
});

describe("formatMinutes", () => {
  it("renders a sub-minute value as seconds", () => {
    expect(formatMinutes(minutes(0.75))).toBe("45s");
    expect(formatMinutes(minutes(0.5))).toBe("30s");
  });

  it("renders a whole minute without a decimal", () => {
    expect(formatMinutes(minutes(12))).toBe("12min");
  });

  it("keeps one decimal for a fractional minute above 1", () => {
    expect(formatMinutes(minutes(3.5))).toBe("3.5min");
  });

  it("returns empty for a non-finite value rather than 'NaNmin'", () => {
    expect(formatMinutes(minutes(Number.NaN))).toBe("");
    expect(formatMinutes(minutes(Number.POSITIVE_INFINITY))).toBe("");
  });
});

describe("METRES_PER_MILE is the single source of truth (audit L6)", () => {
  it("agrees with the km<->miles path to within a micrometre over a marathon", () => {
    // These were two independent literals (1609.34 and 1/0.621371), so the same
    // mile converted to two different metre counts depending on the call path.
    const viaKm = userDistanceToMeters(26.2, "miles");
    const viaConstant = 26.2 * METRES_PER_MILE;
    expect(Math.abs(viaKm - viaConstant)).toBeLessThan(1e-6);
  });

  it("uses the exact statute mile", () => {
    expect(METRES_PER_MILE).toBe(1609.344);
    expect(convertDistance(1, "miles", "km") * 1000).toBeCloseTo(METRES_PER_MILE, 9);
  });
});
