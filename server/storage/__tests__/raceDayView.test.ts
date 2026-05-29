import { describe, expect, it } from "vitest";

import { deriveRaceDayOverride } from "../raceDayView";

describe("deriveRaceDayOverride", () => {
  const RACE = "2026-07-11";

  it("marks the race date itself as the Race Day (no accessory)", () => {
    const override = deriveRaceDayOverride(RACE, RACE);
    expect(override).not.toBeNull();
    expect(override!.focus).toBe("Race Day");
    expect(override!.accessory).toBeNull();
    expect(override!.mainWorkout).toMatch(/HYROX/i);
  });

  it("marks the day before the race as a Shakeout", () => {
    expect(deriveRaceDayOverride("2026-07-10", RACE)?.focus).toBe("Shakeout");
  });

  it("marks any day after the race as Recovery", () => {
    expect(deriveRaceDayOverride("2026-07-12", RACE)?.focus).toBe("Recovery");
    expect(deriveRaceDayOverride("2026-08-01", RACE)?.focus).toBe("Recovery");
  });

  it("leaves normal days (before the shakeout) untouched", () => {
    expect(deriveRaceDayOverride("2026-07-09", RACE)).toBeNull();
    expect(deriveRaceDayOverride("2026-06-01", RACE)).toBeNull();
  });

  it("returns null when the plan has no race date", () => {
    expect(deriveRaceDayOverride("2026-07-11", null)).toBeNull();
    expect(deriveRaceDayOverride("2026-07-11", undefined)).toBeNull();
  });
});
