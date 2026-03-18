import { describe, it, expect } from "vitest";
import {
  convertWeight,
  convertDistance,
  metersToUserDistance,
  userDistanceToMeters,
  kgToUserWeight,
  userWeightToKg,
  formatPace,
  formatSpeed,
  formatElevation,
  formatWeight,
  formatDistance,
} from "./unitConversion";

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
});

describe("metersToUserDistance", () => {
  it("handles very large meters", () => {
    expect(metersToUserDistance(1000000000, "km")).toBeCloseTo(1000000, 0);
    expect(metersToUserDistance(1000000000, "miles")).toBeCloseTo(621371, 0);
  });

  it("handles very small fractional meters", () => {
    expect(metersToUserDistance(0.001, "km")).toBeCloseTo(0.000001, 6);
    expect(metersToUserDistance(0.001, "miles")).toBeCloseTo(0.000000621371, 6);
  });

  it("converts meters to km", () => {
    expect(metersToUserDistance(5000, "km")).toBeCloseTo(5, 5);
  });

  it("converts meters to miles", () => {
    expect(metersToUserDistance(1609.34, "miles")).toBeCloseTo(1, 1);
  });

  it("handles zero meters", () => {
    expect(metersToUserDistance(0, "km")).toBe(0);
    expect(metersToUserDistance(0, "miles")).toBe(0);
  });

  it("handles negative meters", () => {
    expect(metersToUserDistance(-1000, "km")).toBeCloseTo(-1, 5);
    expect(metersToUserDistance(-1609.34, "miles")).toBeCloseTo(-1, 1);
  });

  it("handles fractional meters", () => {
    expect(metersToUserDistance(1500.5, "km")).toBeCloseTo(1.5005, 5);
    expect(metersToUserDistance(1609.34 / 2, "miles")).toBeCloseTo(0.5, 1);
  });
});

describe("userDistanceToMeters", () => {
  it("converts km to meters", () => {
    expect(userDistanceToMeters(5, "km")).toBeCloseTo(5000, 0);
  });

  it("converts miles to meters", () => {
    expect(userDistanceToMeters(1, "miles")).toBeCloseTo(1609.34, 0);
  });

  it("handles zero distance", () => {
    expect(userDistanceToMeters(0, "km")).toBe(0);
    expect(userDistanceToMeters(0, "miles")).toBe(0);
  });

  it("handles negative distances", () => {
    expect(userDistanceToMeters(-5, "km")).toBeCloseTo(-5000, 0);
    expect(userDistanceToMeters(-1, "miles")).toBeCloseTo(-1609.34, 0);
  });

  it("handles fractional distances", () => {
    expect(userDistanceToMeters(1.5, "km")).toBeCloseTo(1500, 0);
    expect(userDistanceToMeters(0.5, "miles")).toBeCloseTo(1609.34 / 2, 0);
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
    expect(formatPace(NaN, "km")).toBe("-");
    expect(formatPace(NaN, "miles")).toBe("-");
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
  it("formats with unit", () => {
    expect(formatDistance(5.123, "km")).toBe("5.12 km");
    expect(formatDistance(3.1, "miles", 1)).toBe("3.1 miles");
  });
});
