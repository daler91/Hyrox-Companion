import { describe, expect, it } from "vitest";

import { findInconsistentHeartRate } from "./heartRateConsistency";

describe("findInconsistentHeartRate", () => {
  it("rejects a one-sided max below the stored average", () => {
    expect(
      findInconsistentHeartRate({ maxHeartrate: 150 }, { avgHeartrate: 180, maxHeartrate: 190 }),
    ).toMatch(/max heart rate/i);
  });

  it("rejects a one-sided avg above the stored max", () => {
    expect(
      findInconsistentHeartRate({ avgHeartrate: 200 }, { avgHeartrate: 150, maxHeartrate: 180 }),
    ).toMatch(/max heart rate/i);
  });

  it("rejects an inconsistent pair supplied entirely in the patch", () => {
    expect(findInconsistentHeartRate({ avgHeartrate: 180, maxHeartrate: 150 }, {})).toMatch(
      /max heart rate/i,
    );
  });

  it("accepts a consistent merged pair", () => {
    expect(
      findInconsistentHeartRate({ maxHeartrate: 200 }, { avgHeartrate: 180, maxHeartrate: 190 }),
    ).toBeNull();
    expect(
      findInconsistentHeartRate({ avgHeartrate: 150 }, { avgHeartrate: 200, maxHeartrate: 210 }),
    ).toBeNull();
    expect(
      findInconsistentHeartRate({ maxHeartrate: 180 }, { avgHeartrate: 180, maxHeartrate: 180 }),
    ).toBeNull();
  });

  it("ignores updates that touch neither heart-rate field", () => {
    expect(findInconsistentHeartRate({}, { avgHeartrate: 180, maxHeartrate: 150 })).toBeNull();
  });

  it("skips the check when one side is cleared to null", () => {
    expect(
      findInconsistentHeartRate({ maxHeartrate: null }, { avgHeartrate: 180, maxHeartrate: 190 }),
    ).toBeNull();
    expect(
      findInconsistentHeartRate({ avgHeartrate: null }, { avgHeartrate: 180, maxHeartrate: 190 }),
    ).toBeNull();
  });
});
