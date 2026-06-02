import { describe, expect, it } from "vitest";

import { formatSecondsToMmSs } from "./statsUtils";
import { parseDurationToSeconds } from "./workoutDuration";

describe("parseDurationToSeconds", () => {
  it("parses mm:ss", () => {
    expect(parseDurationToSeconds("28:30")).toBe(1710);
    expect(parseDurationToSeconds("4:32")).toBe(272);
    expect(parseDurationToSeconds("0:09")).toBe(9);
  });

  it("parses h:mm:ss", () => {
    expect(parseDurationToSeconds("1:00:00")).toBe(3600);
    expect(parseDurationToSeconds("1:02:03")).toBe(3723);
  });

  it("treats a bare number as minutes", () => {
    expect(parseDurationToSeconds("5")).toBe(300);
    expect(parseDurationToSeconds("0")).toBe(0);
  });

  it("rejects blanks, garbage, and out-of-range parts", () => {
    expect(parseDurationToSeconds("")).toBeNull();
    expect(parseDurationToSeconds("   ")).toBeNull();
    expect(parseDurationToSeconds(null)).toBeNull();
    expect(parseDurationToSeconds(undefined)).toBeNull();
    expect(parseDurationToSeconds("abc")).toBeNull();
    expect(parseDurationToSeconds("28:75")).toBeNull(); // seconds overflow
    expect(parseDurationToSeconds("1:75:00")).toBeNull(); // minutes overflow
    expect(parseDurationToSeconds("1:2:3:4")).toBeNull(); // too many parts
    expect(parseDurationToSeconds("-5")).toBeNull();
    expect(parseDurationToSeconds("5:-3")).toBeNull();
  });

  it("round-trips with formatSecondsToMmSs", () => {
    const seconds = parseDurationToSeconds("28:30");
    expect(seconds).not.toBeNull();
    expect(formatSecondsToMmSs(seconds as number)).toBe("28:30");
  });
});
