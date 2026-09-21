import { describe, expect, it } from "vitest";

import { formatSecondsToClock } from "./formatClock";

describe("formatSecondsToClock", () => {
  it("formats hours, zero-padded minutes and seconds", () => {
    expect(formatSecondsToClock(4530)).toBe("1:15:30");
    expect(formatSecondsToClock(59)).toBe("0:00:59");
    expect(formatSecondsToClock(3600)).toBe("1:00:00");
  });

  it("rounds and clamps unusable input", () => {
    expect(formatSecondsToClock(90.6)).toBe("0:01:31");
    expect(formatSecondsToClock(-5)).toBe("0:00:00");
    expect(formatSecondsToClock(Number.NaN)).toBe("0:00:00");
  });
});
