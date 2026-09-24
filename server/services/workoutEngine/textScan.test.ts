import { describe, expect, it } from "vitest";

import { numberEnd, replaceFirstValue, valueEnd } from "./textScan";

describe("numberEnd and valueEnd", () => {
  it("read a number, a decimal and a range, and nothing past them", () => {
    expect(numberEnd("82.5 kg", 0)).toBe(4);
    expect(numberEnd("7. Then", 0)).toBe(1);
    expect(numberEnd("kg", 0)).toBe(-1);
    expect(valueEnd("8-10 reps", 0)).toBe(4);
    expect(valueEnd("80 – 82.5 kg", 0)).toBe(9);
    expect(valueEnd("8 - then", 0)).toBe(1);
    expect(valueEnd("@ 90", 2)).toBe(4);
  });
});

describe("replaceFirstValue", () => {
  const load = /\s*(?:kg|lbs?)\b/iy;

  it("replaces the first value after its head, together with its tail", () => {
    expect(replaceFirstValue("4 x 8-10 @ 80-85 lbs, RPE 7", /@\s*/g, "@ 90 kg", load)).toBe(
      "4 x 8-10 @ 90 kg, RPE 7",
    );
  });

  it("skips a head whose value is not closed by the tail", () => {
    expect(replaceFirstValue("@ 70% of 1RM, then @ 80 kg", /@\s*/g, "@ 90 kg", load)).toBe(
      "@ 70% of 1RM, then @ 90 kg",
    );
  });

  it("returns the text unchanged when no value follows the head", () => {
    expect(replaceFirstValue("RPE high", /RPE[\s~]*/gi, "RPE 8")).toBe("RPE high");
  });
});
