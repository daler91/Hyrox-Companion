import { describe, expect, it } from "vitest";

import { describeInvalidPreferences, describePreferencesRejection } from "./preferencesValidation";

const WHERE = "Fix it on the Training tab, then save again.";

/** The error shape queryClient throws for a failed API call: "<status>: <json body>". */
function apiError(status: number, body: unknown): Error {
  return new Error(`${String(status)}: ${JSON.stringify(body)}`);
}

describe("describeInvalidPreferences", () => {
  it("returns null when every numeric field is inside its range, or absent", () => {
    expect(describeInvalidPreferences({}, "kg")).toBeNull();
    expect(
      describeInvalidPreferences(
        { age: 35, restingHr: 55, maxHr: 190, ftp: 250, weeklyGoal: 4, mafAge: 35, bodyweightKg: 80, heightCm: 180 },
        "kg",
      ),
    ).toBeNull();
  });

  it("treats null and undefined as 'cleared', not invalid", () => {
    expect(describeInvalidPreferences({ restingHr: null, ftp: undefined }, "kg")).toBeNull();
  });

  it("accepts values exactly on the inclusive bounds", () => {
    expect(describeInvalidPreferences({ restingHr: 30 }, "kg")).toBeNull();
    expect(describeInvalidPreferences({ restingHr: 120 }, "kg")).toBeNull();
  });

  it("names the field, the minimum and the tab for a value below an inclusive minimum", () => {
    expect(describeInvalidPreferences({ restingHr: 25 }, "kg")).toBe(
      `Resting heart rate must be at least 30 bpm. ${WHERE}`,
    );
  });

  it("names the maximum for a value above the range", () => {
    expect(describeInvalidPreferences({ ftp: 601 }, "kg")).toBe(
      `Functional threshold power must be 600 W or less. ${WHERE}`,
    );
  });

  it("says 'more than' for an exclusive minimum, so zero is refused", () => {
    expect(describeInvalidPreferences({ heightCm: 0 }, "kg")).toBe(`Height must be more than 0 cm. ${WHERE}`);
  });

  it("refuses a fractional value for a whole-number field", () => {
    expect(describeInvalidPreferences({ weeklyGoal: 3.5 }, "kg")).toBe(
      `Weekly workout goal must be a whole number. ${WHERE}`,
    );
  });

  it("refuses NaN, Infinity and non-numbers without throwing", () => {
    const message = `Age has a value Settings can't save. ${WHERE}`;
    expect(describeInvalidPreferences({ age: Number.NaN }, "kg")).toBe(message);
    expect(describeInvalidPreferences({ age: Number.POSITIVE_INFINITY }, "kg")).toBe(message);
    expect(describeInvalidPreferences({ age: "35" }, "kg")).toBe(message);
  });

  it("shows weight bounds in the athlete's unit, not kg", () => {
    // Weekly rate is capped at 2 kg/week = 4.4 lb/week.
    expect(describeInvalidPreferences({ weightGoalRateKgPerWeek: 5 }, "lbs")).toBe(
      `Weekly rate must be 4.4 lbs or less. ${WHERE}`,
    );
    expect(describeInvalidPreferences({ weightGoalRateKgPerWeek: 5 }, "kg")).toBe(
      `Weekly rate must be 2 kg or less. ${WHERE}`,
    );
  });

  it("converts an exclusive weight minimum for display", () => {
    expect(describeInvalidPreferences({ bodyweightKg: 0 }, "kg")).toBe(`Bodyweight must be more than 0 kg. ${WHERE}`);
  });

  it("reports the first offending field when several are invalid", () => {
    const message = describeInvalidPreferences({ mafAge: 5, age: 5 }, "kg");
    expect(message).toBe(`Age must be at least 13. ${WHERE}`);
  });

  it("ignores fields it has no range for", () => {
    expect(describeInvalidPreferences({ notifyHour: 99, somethingElse: -1 }, "kg")).toBeNull();
  });
});

describe("describePreferencesRejection", () => {
  const validation = (path: unknown) =>
    apiError(400, { code: "VALIDATION_ERROR", error: "Invalid", details: { issues: [{ path, message: "bad" }] } });

  it("names the field the server refused", () => {
    expect(describePreferencesRejection(validation("maxHr"))).toBe(
      `Max heart rate has a value Settings can't save. ${WHERE}`,
    );
  });

  it("uses only the top-level segment of a dotted issue path", () => {
    expect(describePreferencesRejection(validation("ftp.value"))).toBe(
      `Functional threshold power has a value Settings can't save. ${WHERE}`,
    );
  });

  it("falls back to a generic subject when the field is unknown or the path is not a string", () => {
    const generic = `One of your settings has a value Settings can't save. ${WHERE}`;
    expect(describePreferencesRejection(validation("notifyHour"))).toBe(generic);
    expect(describePreferencesRejection(validation(["maxHr"]))).toBe(generic);
    expect(
      describePreferencesRejection(apiError(400, { code: "VALIDATION_ERROR", error: "Invalid" })),
    ).toBe(generic);
  });

  it("returns null for any failure that is not a validation refusal", () => {
    expect(describePreferencesRejection(apiError(500, { code: "INTERNAL_SERVER_ERROR" }))).toBeNull();
    expect(describePreferencesRejection(new Error("Failed to fetch"))).toBeNull();
    expect(describePreferencesRejection("nope")).toBeNull();
    expect(describePreferencesRejection(null)).toBeNull();
  });
});
