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
  it("formats pace in min/km", () => {
    const pace = formatPace(3.333, "km");
    expect(pace).toMatch(/\d+:\d{2}\/km/);
  });

  it("formats pace in min/mi", () => {
    const pace = formatPace(3.333, "miles");
    expect(pace).toMatch(/\d+:\d{2}\/mi/);
  });

  it("returns N/A for zero speed", () => {
    expect(formatPace(0, "km")).toBe("N/A");
  });

  it("returns N/A for negative speed", () => {
    expect(formatPace(-1, "km")).toBe("N/A");
  });
});

describe("formatSpeed", () => {
  it("formats speed in km/h", () => {
    const speed = formatSpeed(3.0, "km");
    expect(speed).toMatch(/[\d.]+ km\/h/);
  });

  it("formats speed in mph", () => {
    const speed = formatSpeed(3.0, "miles");
    expect(speed).toMatch(/[\d.]+ mph/);
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
    expect(result).toMatch(/\d+ ft/);
  });
});

describe("formatWeight", () => {
  it("formats with unit", () => {
    expect(formatWeight(100, "kg")).toBe("100.0 kg");
    expect(formatWeight(220, "lbs", 0)).toBe("220 lbs");
  });
});

describe("formatDistance", () => {
  it("formats with unit", () => {
    expect(formatDistance(5.123, "km")).toBe("5.12 km");
    expect(formatDistance(3.1, "miles", 1)).toBe("3.1 miles");
  });
});
