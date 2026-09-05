import { describe, expect,it } from "vitest";

import {
  cmToFtIn,
  convertDistance,
  convertWeight,
  displayDistanceToStored,
  formatDistance,
  formatElevation,
  formatPace,
  formatSpeed,
  formatWeight,
  ftInToCm,
  getStoredDistanceUnit,
  getWorkoutDistanceDisplay,
  kgToUserWeight,
  metersToUserDistance,
  normalizeParsedDistance,
  normalizeParsedWeight,
  normalizeWorkoutTextUnits,
  restampSetPatch,
  roundStoredDistance,
  roundStoredWeight,
  stampForPreferences,
  standardizeDistanceUnit,
  standardizeParsedDistanceUnit,
  standardizeWeightUnit,
  storedDistanceToDisplay,
  storedWeightToDisplay,
  storedWeightToKg,
  userDistanceToMeters,
  userWeightToKg,
} from "./unitConversion";


describe("standardizeWeightUnit", () => {
  it("returns kg for standard variations", () => {
    expect(standardizeWeightUnit("kg")).toBe("kg");
    expect(standardizeWeightUnit("kgs")).toBe("kg");
    expect(standardizeWeightUnit("kilo")).toBe("kg");
    expect(standardizeWeightUnit("kilograms")).toBe("kg");
  });

  it("returns lbs for standard variations", () => {
    expect(standardizeWeightUnit("lbs")).toBe("lbs");
    expect(standardizeWeightUnit("lb")).toBe("lbs");
    expect(standardizeWeightUnit("pound")).toBe("lbs");
    expect(standardizeWeightUnit("pounds")).toBe("lbs");
  });

  it("returns kg for undefined, null, or unknown inputs", () => {
    expect(standardizeWeightUnit(undefined)).toBe("kg");
    expect(standardizeWeightUnit(null)).toBe("kg");
    expect(standardizeWeightUnit("")).toBe("kg");
    expect(standardizeWeightUnit("stones")).toBe("kg");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(standardizeWeightUnit(" LBS ")).toBe("lbs");
    expect(standardizeWeightUnit("  kGs ")).toBe("kg");
  });
});

describe("standardizeDistanceUnit", () => {
  it("returns km for standard variations", () => {
    expect(standardizeDistanceUnit("km")).toBe("km");
    expect(standardizeDistanceUnit("kms")).toBe("km");
    expect(standardizeDistanceUnit("kilometer")).toBe("km");
    expect(standardizeDistanceUnit("kilometers")).toBe("km");
  });

  it("returns miles for standard variations", () => {
    expect(standardizeDistanceUnit("miles")).toBe("miles");
    expect(standardizeDistanceUnit("mile")).toBe("miles");
    expect(standardizeDistanceUnit("mi")).toBe("miles");
  });

  it("returns km for undefined, null, or unknown inputs", () => {
    expect(standardizeDistanceUnit(undefined)).toBe("km");
    expect(standardizeDistanceUnit(null)).toBe("km");
    expect(standardizeDistanceUnit("")).toBe("km");
    expect(standardizeDistanceUnit("feet")).toBe("km");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(standardizeDistanceUnit(" MILES ")).toBe("miles");
    expect(standardizeDistanceUnit("  kM ")).toBe("km");
  });
});

describe("standardizeParsedDistanceUnit", () => {
  it("keeps meters and feet distinct from preference units", () => {
    expect(standardizeParsedDistanceUnit("m")).toBe("m");
    expect(standardizeParsedDistanceUnit("meters")).toBe("m");
    expect(standardizeParsedDistanceUnit("ft")).toBe("ft");
    expect(standardizeParsedDistanceUnit("feet")).toBe("ft");
    expect(standardizeParsedDistanceUnit("km")).toBe("km");
    expect(standardizeParsedDistanceUnit("mi")).toBe("miles");
  });

  it("returns null for missing or unknown inputs", () => {
    expect(standardizeParsedDistanceUnit(undefined)).toBeNull();
    expect(standardizeParsedDistanceUnit(null)).toBeNull();
    expect(standardizeParsedDistanceUnit("yards")).toBeNull();
  });
});

describe("convertWeight", () => {
  it("converts kg to lbs", () => {
    expect(convertWeight(100, "kg", "lbs")).toBeCloseTo(220.462, 1);
  });

  it("converts lbs to kg", () => {
    expect(convertWeight(220.462, "lbs", "kg")).toBeCloseTo(100, 1);
  });

  it("returns same value for same unit", () => {
    expect(convertWeight(75, "kg", "kg")).toBe(75);
    expect(convertWeight(165, "lbs", "lbs")).toBe(165);
  });

  it("round-trips accurately", () => {
    const original = 80;
    const lbs = convertWeight(original, "kg", "lbs");
    const back = convertWeight(lbs, "lbs", "kg");
    expect(back).toBeCloseTo(original, 5);
  });

  it("handles zero weight correctly", () => {
    expect(convertWeight(0, "kg", "lbs")).toBe(0);
    expect(convertWeight(0, "lbs", "kg")).toBe(0);
  });

  it("handles negative weights correctly", () => {
    expect(convertWeight(-100, "kg", "lbs")).toBeCloseTo(-220.462, 1);
    expect(convertWeight(-220.462, "lbs", "kg")).toBeCloseTo(-100, 1);
  });

  it("handles very small fractional weights", () => {
    expect(convertWeight(0.001, "kg", "lbs")).toBeCloseTo(0.00220462, 6);
    expect(convertWeight(0.00220462, "lbs", "kg")).toBeCloseTo(0.001, 6);
  });

  it("handles very large weights", () => {
    expect(convertWeight(1000000, "kg", "lbs")).toBeCloseTo(2204620, 0);
    expect(convertWeight(2204620, "lbs", "kg")).toBeCloseTo(1000000, 0);
  });

  it("handles Number.NaN correctly", () => {
    expect(convertWeight(Number.NaN, "kg", "lbs")).toBeNaN();
    expect(convertWeight(Number.NaN, "lbs", "kg")).toBeNaN();
  });

  it("handles Infinity correctly", () => {
    expect(convertWeight(Infinity, "kg", "lbs")).toBe(Infinity);
    expect(convertWeight(Infinity, "lbs", "kg")).toBe(Infinity);
  });

  it("handles -Infinity correctly", () => {
    expect(convertWeight(-Infinity, "kg", "lbs")).toBe(-Infinity);
    expect(convertWeight(-Infinity, "lbs", "kg")).toBe(-Infinity);
  });
});

describe("convertDistance", () => {
  it("converts km to miles", () => {
    expect(convertDistance(10, "km", "miles")).toBeCloseTo(6.21371, 2);
  });

  it("converts miles to km", () => {
    expect(convertDistance(6.21371, "miles", "km")).toBeCloseTo(10, 2);
  });

  it("returns same value for same unit", () => {
    expect(convertDistance(5, "km", "km")).toBe(5);
    expect(convertDistance(3, "miles", "miles")).toBe(3);
  });

  it("round-trips accurately", () => {
    const original = 42;
    const miles = convertDistance(original, "km", "miles");
    const back = convertDistance(miles, "miles", "km");
    expect(back).toBeCloseTo(original, 5);
  });

  it("handles zero distance correctly", () => {
    expect(convertDistance(0, "km", "miles")).toBe(0);
    expect(convertDistance(0, "miles", "km")).toBe(0);
  });

  it("handles negative distances correctly", () => {
    expect(convertDistance(-10, "km", "miles")).toBeCloseTo(-6.21371, 2);
    expect(convertDistance(-6.21371, "miles", "km")).toBeCloseTo(-10, 2);
  });

  it("handles very small fractional distances", () => {
    expect(convertDistance(0.001, "km", "miles")).toBeCloseTo(0.000621371, 6);
    expect(convertDistance(0.000621371, "miles", "km")).toBeCloseTo(0.001, 6);
  });

  it("handles very large distances", () => {
    expect(convertDistance(1000000, "km", "miles")).toBeCloseTo(621371, 0);
    expect(convertDistance(621371, "miles", "km")).toBeCloseTo(1000000, 0);
  });
});

describe("metersToUserDistance", () => {
  it("handles very large meters", () => {
    expect(metersToUserDistance(1000000000, "km")).toBeCloseTo(1000000, 0);
    expect(metersToUserDistance(1000000000, "miles")).toBeCloseTo(621371.19, 1);
  });

  it("handles very small fractional meters", () => {
    expect(metersToUserDistance(0.001, "km")).toBeCloseTo(0.000001, 6);
    expect(metersToUserDistance(0.001, "miles")).toBeCloseTo(0.000000621373, 6);
  });

  it("converts meters to km", () => {
    expect(metersToUserDistance(5000, "km")).toBeCloseTo(5, 5);
  });

  it("converts meters to miles", () => {
    expect(metersToUserDistance(1609.344, "miles")).toBeCloseTo(1, 1);
  });

  it("converts meters to mi", () => {
    expect(metersToUserDistance(1609.344, "mi")).toBeCloseTo(1, 1);
  });

  it("handles zero meters", () => {
    expect(metersToUserDistance(0, "km")).toBe(0);
    expect(metersToUserDistance(0, "miles")).toBe(0);
  });

  it("handles negative meters", () => {
    expect(metersToUserDistance(-1000, "km")).toBeCloseTo(-1, 5);
    expect(metersToUserDistance(-1609.344, "miles")).toBeCloseTo(-1, 1);
  });

  it("handles fractional meters", () => {
    expect(metersToUserDistance(1500.5, "km")).toBeCloseTo(1.5005, 5);
    expect(metersToUserDistance(1609.344 / 2, "miles")).toBeCloseTo(0.5, 1);
  });

  it("falls back to km when unrecognized distanceUnit is passed", () => {
    expect(metersToUserDistance(5000, "feet")).toBe(5);
    expect(metersToUserDistance(100, "")).toBe(0.1);
  });
});

describe("userDistanceToMeters", () => {
  it("converts km to meters", () => {
    expect(userDistanceToMeters(5, "km")).toBeCloseTo(5000, 0);
  });

  it("converts miles to meters", () => {
    expect(userDistanceToMeters(1, "miles")).toBeCloseTo(1609.344, 0);
  });

  it("handles zero distance", () => {
    expect(userDistanceToMeters(0, "km")).toBe(0);
    expect(userDistanceToMeters(0, "miles")).toBe(0);
  });

  it("handles negative distances", () => {
    expect(userDistanceToMeters(-5, "km")).toBeCloseTo(-5000, 0);
    expect(userDistanceToMeters(-1, "miles")).toBeCloseTo(-1609.344, 0);
  });

  it("handles fractional distances", () => {
    expect(userDistanceToMeters(1.5, "km")).toBeCloseTo(1500, 0);
    expect(userDistanceToMeters(0.5, "miles")).toBeCloseTo(1609.344 / 2, 0);
  });
});

describe("kgToUserWeight", () => {
  it("returns kg unchanged for kg users", () => {
    expect(kgToUserWeight(100, "kg")).toBe(100);
  });

  it("converts to lbs for lbs users", () => {
    expect(kgToUserWeight(100, "lbs")).toBeCloseTo(220.462, 1);
  });
});

describe("userWeightToKg", () => {
  it("returns kg unchanged for kg users", () => {
    expect(userWeightToKg(100, "kg")).toBe(100);
  });

  it("converts from lbs for lbs users", () => {
    expect(userWeightToKg(220.462, "lbs")).toBeCloseTo(100, 1);
  });
});

describe("AI write unit normalization", () => {
  it("rounds weights for structured storage", () => {
    expect(roundStoredWeight(165.3465, "lbs")).toBe(165);
    expect(roundStoredWeight(74.77, "kg")).toBe(75);
    expect(roundStoredWeight(74.24, "kg")).toBe(74);
    expect(roundStoredWeight(74.26, "kg")).toBe(74.5);
  });

  it("rounds distances for structured storage", () => {
    expect(roundStoredDistance(164.042)).toBe(164);
  });

  it("chooses the table storage distance unit from user preference", () => {
    expect(getStoredDistanceUnit("km")).toBe("m");
    expect(getStoredDistanceUnit("miles")).toBe("ft");
  });

  it("normalizes explicit parser weights into the user's preferred unit", () => {
    expect(normalizeParsedWeight(75, "kg", { weightUnit: "lbs" })).toBe(165);
    expect(normalizeParsedWeight(165, "lb", { weightUnit: "kg" })).toBe(75);
    expect(normalizeParsedWeight(75, undefined, { weightUnit: "lbs" })).toBe(75);
  });

  it("normalizes explicit parser distances into the table storage unit", () => {
    expect(normalizeParsedDistance(50, "m", { distanceUnit: "miles" })).toBe(164);
    expect(normalizeParsedDistance(1, "mi", { distanceUnit: "km" })).toBe(1609);
    expect(normalizeParsedDistance(5, "km", { distanceUnit: "miles" })).toBe(16404);
    expect(normalizeParsedDistance(164, "ft", { distanceUnit: "km" })).toBe(50);
  });

  it("treats omitted or unknown parsed distance units as meters", () => {
    expect(normalizeParsedDistance(5000, undefined, { distanceUnit: "miles" })).toBe(16404);
    expect(normalizeParsedDistance(5000, "yards", { distanceUnit: "miles" })).toBe(16404);
  });

  const IMPERIAL = { weightUnit: "lbs", distanceUnit: "miles" } as const;
  const METRIC = { weightUnit: "kg", distanceUnit: "km" } as const;

  it("normalizes explicit AI-authored text units for the user's preferences", () => {
    expect(normalizeWorkoutTextUnits("Back squat 3x5 at 75kg", { weightUnit: "lbs", distanceUnit: "miles" })).toBe(
      "Back squat 3x5 at 165 lbs",
    );
    expect(normalizeWorkoutTextUnits("Run 5km then sled push 50m", { weightUnit: "lbs", distanceUnit: "miles" })).toBe(
      "Run 5000 m then sled push 164 ft",
    );
    expect(normalizeWorkoutTextUnits("Bench 165 lb and run 1 mile", { weightUnit: "kg", distanceUnit: "km" })).toBe(
      "Bench 75 kg and run 1.61 km",
    );
  });

  it("does not convert bare m when it is likely minute shorthand", () => {
    expect(normalizeWorkoutTextUnits("10m AMRAP", { weightUnit: "lbs", distanceUnit: "miles" })).toBe("10m AMRAP");
    expect(normalizeWorkoutTextUnits("30m easy run", { weightUnit: "lbs", distanceUnit: "miles" })).toBe("30m easy run");
    expect(normalizeWorkoutTextUnits("AMRAP 10m", { weightUnit: "lbs", distanceUnit: "miles" })).toBe("AMRAP 10m");
  });

  it("still converts bare m when it is likely distance text", () => {
    expect(normalizeWorkoutTextUnits("100m run", { weightUnit: "lbs", distanceUnit: "miles" })).toBe("328 ft run");
  });

  // Range and separator handling, table-driven: these are pure input -> output
  // cases, so a table says more than a run of near-identical expect lines.
  //
  // Ranges used to convert only the bound carrying the unit, because the dash
  // parsed as a minus sign — "80-90kg" came out as "80-198 lbs", telling an
  // athlete to load 36kg instead of 80kg. Thousands separators split the
  // number in two: "1,500m" tokenized as "1" then "500" and printed
  // "1,1640 ft". An ambiguous decimal comma is deliberately left alone:
  // converting the "5" of "7,5kg" on its own is worse than not touching it.
  it.each([
    ["a hyphen range", IMPERIAL, "Bench 5 x 3 @ 80-90kg", "Bench 5 x 3 @ 176-198 lbs"],
    ["a distance range", IMPERIAL, "Run 400-800m repeats", "Run 1312-2625 ft repeats"],
    ["an en dash range", IMPERIAL, "Back squat 3\u20135kg", "Back squat 7\u201311 lbs"],
    ["an em dash range", IMPERIAL, "Back squat 3\u20145kg", "Back squat 7\u201411 lbs"],
    ["a range already in the athlete's units", METRIC, "Tempo 3-4km", "Tempo 3-4km"],
    ["a thousands separator", IMPERIAL, "Sled push 1,500m", "Sled push 4921 ft"],
    ["a thousands separator that stays metric", IMPERIAL, "Row 1,000m", "Row 1000 m"],
    ["an ambiguous decimal comma", IMPERIAL, "Deadlift 7,5kg", "Deadlift 7,5kg"],
  ])("normalizes %s", (_label, preferences, input, expected) => {
    expect(normalizeWorkoutTextUnits(input, preferences)).toBe(expected);
  });

  it("still reads a genuine negative number", () => {
    expect(normalizeWorkoutTextUnits("Deficit -90kg", { weightUnit: "lbs", distanceUnit: "miles" })).toBe(
      "Deficit -198 lbs",
    );
  });
});

describe("getWorkoutDistanceDisplay", () => {
  it("promotes long non-metric feet distances to miles", () => {
    expect(getWorkoutDistanceDisplay(15840, "miles")).toEqual({
      value: 3,
      unit: "mi",
      text: "3 mi",
    });
  });

  it("keeps clean whole-kilometer targets in meters for miles users", () => {
    expect(getWorkoutDistanceDisplay(16404, "miles")).toEqual({
      value: 5000,
      unit: "m",
      text: "5000 m",
    });
    expect(getWorkoutDistanceDisplay(3281, "miles")).toEqual({
      value: 1000,
      unit: "m",
      text: "1000 m",
    });
  });

  it("keeps short non-kilometer distances in feet for miles users", () => {
    expect(getWorkoutDistanceDisplay(164, "miles")).toEqual({
      value: 164,
      unit: "ft",
      text: "164 ft",
    });
  });

  it("keeps stored meters as meters for km users", () => {
    expect(getWorkoutDistanceDisplay(5000, "km")).toEqual({
      value: 5000,
      unit: "m",
      text: "5000 m",
    });
  });

  it("converts display edits back to the stored distance unit", () => {
    expect(displayDistanceToStored(3, "mi", "miles")).toBe(15840);
    expect(displayDistanceToStored(5000, "m", "miles")).toBe(16404);
    expect(displayDistanceToStored(5000, "m", "km")).toBe(5000);
  });
});

describe("formatPace", () => {
  it("formats pace in min/km exactly", () => {
    // 5 m/s = 18 km/h = 3:20 / km
    expect(formatPace(5, "km")).toBe("3:20/km");

    // 3.333... m/s = 12 km/h = 5:00 / km
    expect(formatPace(3.3333333333333335, "km")).toBe("5:00/km");

    // 2.5 m/s = 9 km/h = 6:40 / km
    expect(formatPace(2.5, "km")).toBe("6:40/km");
  });

  it("formats pace in min/mi exactly", () => {
    // 5 m/s = ~11.18 mph = 5:22 / mi
    expect(formatPace(5, "miles")).toBe("5:22/mi");

    // 3.333... m/s = ~7.45 mph = 8:03 / mi
    expect(formatPace(3.3333333333333335, "miles")).toBe("8:03/mi");
  });

  it("returns - for zero speed", () => {
    expect(formatPace(0, "km")).toBe("-");
    expect(formatPace(0, "miles")).toBe("-");
  });

  it("returns - for negative speed", () => {
    expect(formatPace(-1, "km")).toBe("-");
    expect(formatPace(-1, "miles")).toBe("-");
  });

  it("handles NaN inputs", () => {
    expect(formatPace(Number.NaN, "km")).toBe("-");
    expect(formatPace(Number.NaN, "miles")).toBe("-");
  });

  it("pads single digit seconds with a leading zero", () => {
    // 1000 / 309 = ~3.236 m/s => 309 seconds/km => 5:09 / km
    expect(formatPace(1000 / 309, "km")).toBe("5:09/km");
    // 1000 / 301 = ~3.322 m/s => 301 seconds/km => 5:01 / km
    expect(formatPace(1000 / 301, "km")).toBe("5:01/km");
  });

  it("formats exactly 0 seconds with correct padding", () => {
    // 1000 / 300 = 3.333... m/s => 300 seconds/km => 5:00 / km
    expect(formatPace(1000 / 300, "km")).toBe("5:00/km");
  });

  it("rounds up seconds safely when rounding produces exactly 60 seconds", () => {
    // 1000 / 59.6 = 16.7785 m/s => 59.6 seconds/km.
    // Math.floor(59.6 / 60) = 0.
    // Math.round(59.6 % 60) = Math.round(59.6) = 60.
    // Should be rolled over to 1:00, not 0:60.
    expect(formatPace(1000 / 59.6, "km")).toBe("1:00/km");

    // 1000 / 119.5 = 8.368 m/s => 119.5 seconds/km.
    // Math.floor(119.5 / 60) = 1.
    // Math.round(119.5 % 60) = 60.
    // Should be rolled over to 2:00, not 1:60.
    expect(formatPace(1000 / 119.5, "km")).toBe("2:00/km");
  });

  it("handles very slow speeds (large pace values)", () => {
    // 1000 / 3600 = 0.2778 m/s => 3600 seconds/km => 60:00 / km
    expect(formatPace(1000 / 3600, "km")).toBe("60:00/km");

    // 1000 / 5400 = 0.185 m/s => 5400 seconds/km => 90:00 / km
    expect(formatPace(1000 / 5400, "km")).toBe("90:00/km");
  });

  it("handles very fast speeds (small pace values)", () => {
    // 1000 / 1 = 1000 m/s => 1 second/km => 0:01 / km
    expect(formatPace(1000, "km")).toBe("0:01/km");
  });
});

describe("formatSpeed", () => {
  it("formats speed in km/h", () => {
    const speed = formatSpeed(3, "km");
    expect(speed).toBe("10.8 km/h");
  });

  it("formats speed in mph", () => {
    const speed = formatSpeed(3, "miles");
    expect(speed).toBe("6.7 mph");
  });

  it("returns N/A for zero", () => {
    expect(formatSpeed(0, "km")).toBe("N/A");
  });
});

describe("formatElevation", () => {
  it("formats meters for km users", () => {
    expect(formatElevation(150, "km")).toBe("150 m");
  });

  it("formats feet for miles users", () => {
    const result = formatElevation(100, "miles");
    expect(result).toBe("328 ft");
  });
});

describe("formatWeight", () => {
  it("formats with unit", () => {
    expect(formatWeight(100, "kg")).toBe("100 kg");
    expect(formatWeight(220, "lbs", 0)).toBe("220 lbs");
  });
});

describe("formatDistance", () => {
  it("formats with default decimals (2)", () => {
    expect(formatDistance(5.123, "km")).toBe("5.12 km");
    expect(formatDistance(3.1, "miles")).toBe("3.1 miles");
    expect(formatDistance(4.5678, "km")).toBe("4.57 km");
  });

  it("formats with custom decimals", () => {
    expect(formatDistance(3.14159, "miles", 1)).toBe("3.1 miles");
    expect(formatDistance(3.14159, "km", 3)).toBe("3.142 km");
    expect(formatDistance(5.5, "miles", 0)).toBe("6 miles");
    expect(formatDistance(5.4, "km", 0)).toBe("5 km");
  });

  it("handles zero distance", () => {
    expect(formatDistance(0, "km")).toBe("0 km");
    expect(formatDistance(0, "miles", 1)).toBe("0 miles");
  });

  it("handles negative distances", () => {
    expect(formatDistance(-5.123, "km")).toBe("-5.12 km");
    expect(formatDistance(-3.1, "miles", 1)).toBe("-3.1 miles");
  });

  it("handles large numbers", () => {
    expect(formatDistance(1000000.123, "km")).toBe("1000000.12 km");
  });

  it("handles integers accurately", () => {
    expect(formatDistance(42, "km")).toBe("42 km");
    expect(formatDistance(42, "miles", 3)).toBe("42 miles");
  });
});

describe("cmToFtIn / ftInToCm", () => {
  it("splits centimetres into feet and inches", () => {
    expect(cmToFtIn(180)).toEqual({ feet: 5, inches: 11 }); // 70.9" → 71"
    expect(cmToFtIn(152.4)).toEqual({ feet: 5, inches: 0 });
  });

  it("rolls 12 inches up to the next foot", () => {
    // 178.5cm ≈ 70.3" but a value that rounds to 72" must not read 5'12".
    expect(cmToFtIn(182.88)).toEqual({ feet: 6, inches: 0 }); // exactly 72"
  });

  it("round-trips feet+inches back to centimetres", () => {
    expect(ftInToCm(5, 11)).toBeCloseTo(180.34, 2);
    expect(ftInToCm(6, 0)).toBeCloseTo(182.88, 2);
  });
});

// ---------------------------------------------------------------------------
// Per-row unit stamps (audit L4)
// ---------------------------------------------------------------------------

describe("a stored row that records its own unit", () => {
  const KG_ATHLETE = { weightUnit: "kg", distanceUnit: "km" };
  const LB_ATHLETE = { weightUnit: "lbs", distanceUnit: "miles" };
  const LEGACY = { weightUnit: null, distanceUnit: null };

  describe("storedWeightToDisplay", () => {
    it("is the identity while the athlete's unit has not changed", () => {
      // The common case, and the reason the stamp could ship without updating
      // all 23 read sites at once: a read that has not been taught to convert
      // still shows the right number.
      expect(storedWeightToDisplay(100, { weightUnit: "kg" }, KG_ATHLETE)).toBe(100);
      expect(storedWeightToDisplay(225, { weightUnit: "lbs" }, LB_ATHLETE)).toBe(225);
    });

    it("converts a row written before the athlete switched", () => {
      // THE bug. 100 kg logged, then the athlete switches to lbs. Without the
      // stamp the row still reads 100 and is rendered "100 lbs" — the same
      // session, apparently 2.2x lighter, and analytics stacks it as a cliff.
      expect(storedWeightToDisplay(100, { weightUnit: "kg" }, LB_ATHLETE)).toBe(220);
      expect(storedWeightToDisplay(225, { weightUnit: "lbs" }, KG_ATHLETE)).toBe(102);
    });

    it("leaves a legacy row exactly as every read path treated it before", () => {
      // Unstamped rows keep the old behaviour rather than being guessed at.
      // Right for an athlete who never switched; wrong for one who did; not
      // fixable without knowing what they used to prefer.
      expect(storedWeightToDisplay(100, LEGACY, LB_ATHLETE)).toBe(100);
      expect(storedWeightToDisplay(100, LEGACY, KG_ATHLETE)).toBe(100);
    });
  });

  describe("storedDistanceToDisplay", () => {
    it("is the identity while the athlete's unit has not changed", () => {
      expect(storedDistanceToDisplay(5000, { distanceUnit: "m" }, KG_ATHLETE)).toBe(5000);
      expect(storedDistanceToDisplay(1000, { distanceUnit: "ft" }, LB_ATHLETE)).toBe(1000);
    });

    it("converts metres to feet for an athlete who switched to miles", () => {
      // A miles athlete stores FEET (getStoredDistanceUnit), so 5000 m of
      // logged running must not come back as 5000 ft — a 3.3x understatement.
      expect(storedDistanceToDisplay(5000, { distanceUnit: "m" }, LB_ATHLETE)).toBe(16404);
      expect(storedDistanceToDisplay(16404, { distanceUnit: "ft" }, KG_ATHLETE)).toBe(5000);
    });

    it("leaves a legacy row alone", () => {
      expect(storedDistanceToDisplay(5000, LEGACY, LB_ATHLETE)).toBe(5000);
    });
  });

  describe("storedWeightToKg — what the load model reads", () => {
    it("uses the row's own unit, not the athlete's current preference", () => {
      // UTSS must be physiological load. An athlete who switches to lbs used to
      // have their whole kg history re-priced as if it were pounds, which
      // deflates every past session's tonnage by 2.2x and drags the chronic
      // baseline down with it — inflating ACWR and tripping injury warnings.
      expect(storedWeightToKg(100, { weightUnit: "kg" }, LB_ATHLETE)).toBeCloseTo(100, 5);
      expect(storedWeightToKg(220.462, { weightUnit: "lbs" }, KG_ATHLETE)).toBeCloseTo(100, 3);
    });

    it("falls back to the current preference for a legacy row", () => {
      // The same assumption trainingLoadService made before L4, kept explicit.
      expect(storedWeightToKg(220.462, LEGACY, LB_ATHLETE)).toBeCloseTo(100, 3);
      expect(storedWeightToKg(100, LEGACY, KG_ATHLETE)).toBeCloseTo(100, 5);
    });
  });

  describe("stampForPreferences — what gets written", () => {
    it("records the athlete's own units, not a canonical one", () => {
      expect(stampForPreferences(KG_ATHLETE)).toEqual({ weightUnit: "kg", distanceUnit: "m" });
      // A miles athlete stores feet, so that is what the stamp must say.
      expect(stampForPreferences(LB_ATHLETE)).toEqual({ weightUnit: "lbs", distanceUnit: "ft" });
    });

    it("falls back to the schema defaults for an athlete with no preference set", () => {
      expect(stampForPreferences({})).toEqual({ weightUnit: "kg", distanceUnit: "m" });
    });
  });

  it("round-trips a switch out and back without drift", () => {
    // kg -> lbs -> kg must land on the original. The stored number never moves;
    // only the rendering does, so there is nothing to accumulate error.
    const stamp = { weightUnit: "kg" };
    const asLbs = storedWeightToDisplay(100, stamp, LB_ATHLETE);
    expect(asLbs).toBe(220);
    expect(storedWeightToDisplay(100, stamp, KG_ATHLETE)).toBe(100);
  });
});

describe("restampSetPatch — keeping one stamp true for the whole row (audit L4)", () => {
  const KG_ATHLETE = { weightUnit: "kg", distanceUnit: "km" };
  const LB_ATHLETE = { weightUnit: "lbs", distanceUnit: "miles" };

  it("re-stamps a touched axis with the current unit and converts the untouched value on it", () => {
    const existing = { weight: 100, plannedWeight: 90, weightUnit: "kg", distance: 400, distanceUnit: "m" };

    const patch = restampSetPatch(existing, { weight: 230 }, LB_ATHLETE);

    expect(patch).toEqual({ weight: 230, weightUnit: "lbs", plannedWeight: 198 });
  });

  it("leaves an axis the patch does not touch completely alone", () => {
    const existing = { weight: 100, weightUnit: "kg", distance: 400, distanceUnit: "m" };

    expect(restampSetPatch(existing, { reps: 8 } as never, LB_ATHLETE)).toEqual({ reps: 8 });
  });

  it("handles the distance axis the same way (metres → feet for a miles athlete)", () => {
    const existing = { distance: 400, plannedDistance: 1000, distanceUnit: "m", weight: 20, weightUnit: "kg" };

    const patch = restampSetPatch(existing, { distance: 1500 }, LB_ATHLETE);

    expect(patch.distance).toBe(1500);
    expect(patch.distanceUnit).toBe("ft");
    expect(patch.plannedDistance).toBe(3281); // 1,000 m in feet
    expect("weightUnit" in patch).toBe(false);
  });

  it("does not convert a value the patch itself sets, even to null", () => {
    const existing = { weight: 100, plannedWeight: 90, weightUnit: "kg" };

    const patch = restampSetPatch(existing, { weight: 230, plannedWeight: null }, LB_ATHLETE);

    expect(patch).toEqual({ weight: 230, plannedWeight: null, weightUnit: "lbs" });
  });

  it("treats a legacy (unstamped) row's values as already in the current unit", () => {
    const existing = { weight: 100, plannedWeight: 90, weightUnit: null };

    expect(restampSetPatch(existing, { weight: 105 }, KG_ATHLETE)).toEqual({
      weight: 105,
      weightUnit: "kg",
      plannedWeight: 90,
    });
  });

  it("is the identity conversion when the stamp already matches the preference", () => {
    const existing = { weight: 100, plannedWeight: 90, weightUnit: "kg" };

    expect(restampSetPatch(existing, { weight: 105 }, KG_ATHLETE)).toEqual({
      weight: 105,
      weightUnit: "kg",
      plannedWeight: 90,
    });
  });
});
