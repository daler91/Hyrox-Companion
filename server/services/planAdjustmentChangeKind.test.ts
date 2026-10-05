import { describe, expect, it } from "vitest";

import { derivePlanAdjustmentChangeKind } from "./planAdjustmentService";

// The change-kind classification is pure; the proposal flows that use it are
// covered in planAdjustmentService.test.ts.

describe("derivePlanAdjustmentChangeKind", () => {
  it("classifies prescription rewrites as workout_update", () => {
    expect(derivePlanAdjustmentChangeKind({ mainWorkout: "Hyrox class" })).toBe("workout_update");
  });

  it("classifies rest-like rewrites as rest_conversion", () => {
    expect(
      derivePlanAdjustmentChangeKind({ focus: "Rest", mainWorkout: "Complete rest or light walk" }),
    ).toBe("rest_conversion");
  });

  it("classifies date-only moves as reschedule", () => {
    expect(derivePlanAdjustmentChangeKind({ scheduledDate: "2026-07-18" })).toBe("reschedule");
  });

  it("classifies notes/expected-only edits as tune", () => {
    expect(derivePlanAdjustmentChangeKind({ notes: "Keep it easy", expectedRpe: 5 })).toBe("tune");
  });
});

describe("derivePlanAdjustmentChangeKind — rest must be exact (audit H18)", () => {
  it("does not treat 'Active rest + mobility' as a rest conversion", () => {
    // rest_conversion is the one change kind that DELETES a table-backed day's
    // exercise rows. The focus test was /\brest\b/i, so this label matched and
    // the day's entire mobility prescription was silently dropped.
    expect(derivePlanAdjustmentChangeKind({ focus: "Active rest + mobility" })).toBe(
      "workout_update",
    );
    expect(derivePlanAdjustmentChangeKind({ focus: "Active Recovery / rest-ish" })).toBe(
      "workout_update",
    );
  });

  it("still recognises a genuine rest day", () => {
    for (const focus of [
      "Rest",
      "rest day",
      "  Complete Rest  ",
      "Full rest",
      "Day off",
      "Rest.",
    ]) {
      expect(derivePlanAdjustmentChangeKind({ focus })).toBe("rest_conversion");
    }
  });

  it("recognises a rest day declared through mainWorkout", () => {
    expect(derivePlanAdjustmentChangeKind({ mainWorkout: "Complete rest" })).toBe(
      "rest_conversion",
    );
    // ...but not one that merely mentions rest in a prescription.
    expect(derivePlanAdjustmentChangeKind({ mainWorkout: "3 rounds, 90s rest between sets" })).toBe(
      "workout_update",
    );
  });

  it("leaves non-prescription changes alone", () => {
    expect(derivePlanAdjustmentChangeKind({ scheduledDate: "2026-06-15" })).toBe("reschedule");
    expect(derivePlanAdjustmentChangeKind({})).toBe("tune");
  });
});
