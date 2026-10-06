import { describe, expect, it } from "vitest";

import {
  formatPersonalRecordValue,
  formatRecordAmount,
  formatRecordTime,
} from "./personalRecordFormat";

const METRIC_UNITS = { weightLabel: "kg", distanceUnit: "km" } as const;
const IMPERIAL_UNITS = { weightLabel: "lbs", distanceUnit: "miles" } as const;

describe("formatRecordTime", () => {
  it.each([
    [3 + 46 / 60, "3:46"],
    [0.75, "0:45"],
    [12, "12:00"],
    [62 + 3 / 60, "1:02:03"],
  ])("reads %s stored minutes as %s", (storedMinutes, expected) => {
    expect(formatRecordTime(storedMinutes)).toBe(expected);
  });

  it("does not print a second count of 60 for a time just short of a minute boundary", () => {
    expect(formatRecordTime(59.9999)).toBe("1:00:00");
  });
});

describe("formatRecordAmount", () => {
  it("drops float noise but keeps the decimals a plate or a split carries", () => {
    expect(formatRecordAmount(220.46226218)).toBe("220.46");
    expect(formatRecordAmount(101.25)).toBe("101.25");
    expect(formatRecordAmount(105)).toBe("105");
  });
});

// The weekly review's audit H2 rule, now shared with the PR list and the
// new-PR toast (CL35, CL58).
describe("formatPersonalRecordValue", () => {
  it("reads a best time in minutes as a clock, whatever the units", () => {
    expect(formatPersonalRecordValue("bestTime", 3 + 52 / 60, METRIC_UNITS)).toBe("3:52");
    expect(formatPersonalRecordValue("bestTime", 12, IMPERIAL_UNITS)).toBe("12:00");
  });

  it("labels a distance in the unit it is stored in: metres, or feet for a miles athlete", () => {
    expect(formatPersonalRecordValue("maxDistance", 2500, METRIC_UNITS)).toBe("2500 m");
    expect(formatPersonalRecordValue("maxDistance", 164, IMPERIAL_UNITS)).toBe("164 ft");
  });

  it("labels weights and the e1RM in the athlete's weight unit", () => {
    expect(formatPersonalRecordValue("maxWeight", 102.5, METRIC_UNITS)).toBe("102.5 kg");
    expect(formatPersonalRecordValue("estimated1RM", 225, IMPERIAL_UNITS)).toBe("225 lbs");
  });
});
