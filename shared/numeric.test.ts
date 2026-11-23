import { describe, expect, it } from "vitest";

import { clamp, median, medianOrNull, round1 } from "./numeric";

describe("median", () => {
  it("takes the middle value of an odd count, whatever the input order", () => {
    expect(median([9, 1, 5])).toBe(5);
  });

  it("averages the middle pair of an even count", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("leaves its input unsorted", () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe("medianOrNull", () => {
  it("is null for an empty list and the median otherwise", () => {
    expect(medianOrNull([])).toBeNull();
    expect(medianOrNull([7, 3])).toBe(5);
  });
});

describe("clamp", () => {
  it("holds a value to the bounds and passes one inside them through", () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(4, 0, 10)).toBe(4);
  });
});

describe("round1", () => {
  it("rounds to one decimal place", () => {
    expect(round1(2.34)).toBe(2.3);
    expect(round1(2.35)).toBe(2.4);
    expect(round1(-1.25)).toBe(-1.2);
  });
});
