import { describe, expect, it } from "vitest";

import {
  MAX_DISTANCE_METERS,
  MAX_HEART_RATE,
  MIN_HEART_RATE,
  parseOptionalDistanceMeters,
  parseOptionalInt,
  validateManualMetrics,
} from "./manualMetrics";

// These bounds mirror the server schemas (insertWorkoutLogSchema + the MAF-test
// metrics schema). Lock them here so a client/server drift surfaces as a failing
// test rather than a save that silently passes client validation and is then
// rejected on the wire (or on offline-queue replay).
describe("manual metric bounds", () => {
  it("matches the documented server bounds", () => {
    expect(MIN_HEART_RATE).toBe(20);
    expect(MAX_HEART_RATE).toBe(250);
    expect(MAX_DISTANCE_METERS).toBe(1_000_000);
  });
});

describe("parseOptionalInt", () => {
  it('treats "not entered" input as null rather than a meaningful value', () => {
    expect(parseOptionalInt(undefined)).toBeNull();
    expect(parseOptionalInt("")).toBeNull();
    expect(parseOptionalInt("   ")).toBeNull();
  });

  it("parses whole numbers, ignoring surrounding whitespace", () => {
    expect(parseOptionalInt("145")).toBe(145);
    expect(parseOptionalInt("  145  ")).toBe(145);
  });

  it('keeps "0" as a real value, not null', () => {
    // Blank must mean "not entered", but an explicit 0 is a value the caller
    // entered on purpose — never coerce the two together.
    expect(parseOptionalInt("0")).toBe(0);
  });

  it("rejects fractional input instead of truncating it", () => {
    // The bug this guards against: Number-vs-parseInt. parseInt("145.9") would
    // silently persist 145, a value the user never typed.
    expect(parseOptionalInt("145.9")).toBeNull();
    expect(parseOptionalInt("0.5")).toBeNull();
  });

  it("rejects non-numeric and partially-numeric strings", () => {
    expect(parseOptionalInt("abc")).toBeNull();
    expect(parseOptionalInt("5xyz")).toBeNull(); // Number(), not parseInt() → no partial parse
    expect(parseOptionalInt("1 2")).toBeNull();
  });

  it("rejects non-finite input", () => {
    expect(parseOptionalInt("Infinity")).toBeNull();
    expect(parseOptionalInt("NaN")).toBeNull();
  });

  it("does not enforce range here — negatives parse through (range is validated elsewhere)", () => {
    expect(parseOptionalInt("-5")).toBe(-5);
  });
});

describe("parseOptionalDistanceMeters", () => {
  it('treats "not entered" input as null', () => {
    expect(parseOptionalDistanceMeters(undefined, "km")).toBeNull();
    expect(parseOptionalDistanceMeters("", "km")).toBeNull();
    expect(parseOptionalDistanceMeters("   ", "km")).toBeNull();
  });

  it("converts a km-unit value into canonical meters", () => {
    expect(parseOptionalDistanceMeters("5", "km")).toBe(5000);
    expect(parseOptionalDistanceMeters("1.5", "km")).toBe(1500);
  });

  it("converts a miles-unit value into canonical meters", () => {
    // 1 mile ≈ 1609.34 m → rounded to the nearest whole meter.
    expect(parseOptionalDistanceMeters("1", "miles")).toBe(1609);
  });

  it("rounds to the nearest whole meter", () => {
    expect(parseOptionalDistanceMeters("1.2344", "km")).toBe(1234);
    expect(parseOptionalDistanceMeters("1.2345", "km")).toBe(1235);
  });

  it('keeps "0" as 0 meters, not null', () => {
    expect(parseOptionalDistanceMeters("0", "km")).toBe(0);
  });

  it("rejects negative distances", () => {
    expect(parseOptionalDistanceMeters("-5", "km")).toBeNull();
  });

  it("rejects non-numeric, partial, and non-finite input", () => {
    expect(parseOptionalDistanceMeters("abc", "km")).toBeNull();
    expect(parseOptionalDistanceMeters("5xyz", "km")).toBeNull(); // no partial parse
    expect(parseOptionalDistanceMeters("Infinity", "km")).toBeNull();
  });

  it("falls back to km when the unit is unrecognised (mirrors standardizeDistanceUnit)", () => {
    expect(parseOptionalDistanceMeters("5", "furlongs")).toBe(5000);
  });
});

describe("validateManualMetrics", () => {
  const km = "km";

  it("returns null when every field is blank", () => {
    expect(validateManualMetrics(undefined, undefined, undefined, km)).toBeNull();
    expect(validateManualMetrics("", "", "", km)).toBeNull();
  });

  it("returns null for in-range values", () => {
    expect(validateManualMetrics("5", "150", "175", km)).toBeNull();
  });

  describe("distance bounds", () => {
    it("rejects a distance above the maximum", () => {
      // 1001 km → 1,001,000 m, just over the 1,000,000 m cap.
      expect(validateManualMetrics("1001", undefined, undefined, km)).toBe(
        "That distance looks too large — please double-check it.",
      );
    });

    it("accepts a distance exactly at the maximum (inclusive bound)", () => {
      // 1000 km → exactly 1,000,000 m — must not be rejected.
      expect(validateManualMetrics("1000", undefined, undefined, km)).toBeNull();
    });
  });

  describe("heart-rate bounds", () => {
    it("accepts the inclusive min and max with a matching counterpart", () => {
      expect(
        validateManualMetrics(undefined, String(MIN_HEART_RATE), String(MAX_HEART_RATE), km),
      ).toBeNull();
    });

    it("rejects a heart rate below the minimum", () => {
      expect(validateManualMetrics(undefined, String(MIN_HEART_RATE - 1), undefined, km)).toBe(
        `Average heart rate must be between ${MIN_HEART_RATE} and ${MAX_HEART_RATE} bpm.`,
      );
    });

    it("rejects a heart rate above the maximum", () => {
      expect(validateManualMetrics(undefined, undefined, String(MAX_HEART_RATE + 1), km)).toBe(
        `Max heart rate must be between ${MIN_HEART_RATE} and ${MAX_HEART_RATE} bpm.`,
      );
    });

    it("rejects fractional heart rates with a whole-number message", () => {
      expect(validateManualMetrics(undefined, "145.9", undefined, km)).toBe(
        "Average heart rate must be a whole number.",
      );
      expect(validateManualMetrics(undefined, "150", "175.5", km)).toBe(
        "Max heart rate must be a whole number.",
      );
    });

    it("rejects non-numeric heart rates as not-a-whole-number", () => {
      expect(validateManualMetrics(undefined, "abc", undefined, km)).toBe(
        "Average heart rate must be a whole number.",
      );
    });

    it("checks the average field before the max field", () => {
      // Both are invalid; the average message must win because it is validated
      // first — keeps the surfaced error stable for the form.
      expect(validateManualMetrics(undefined, "145.9", "300.1", km)).toBe(
        "Average heart rate must be a whole number.",
      );
    });
  });

  describe("average vs max relationship", () => {
    it("rejects a max lower than the average", () => {
      expect(validateManualMetrics(undefined, "150", "140", km)).toBe(
        "Max heart rate can't be lower than average heart rate.",
      );
    });

    it("accepts a max equal to the average (inclusive)", () => {
      expect(validateManualMetrics(undefined, "150", "150", km)).toBeNull();
    });

    it("does not cross-check when only one of the two is provided", () => {
      expect(validateManualMetrics(undefined, "150", undefined, km)).toBeNull();
      expect(validateManualMetrics(undefined, undefined, "140", km)).toBeNull();
    });
  });

  it("surfaces the distance error before heart-rate errors when both are invalid", () => {
    // Distance is validated first; lock the precedence so the message order is
    // not accidentally reshuffled by a future refactor.
    expect(validateManualMetrics("1001", "999", undefined, km)).toBe(
      "That distance looks too large — please double-check it.",
    );
  });
});
