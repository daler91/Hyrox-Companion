import { describe, expect, it } from "vitest";

import { shouldTriggerParseOnContinue } from "../parseCheckpoint";

describe("shouldTriggerParseOnContinue", () => {
  it("returns false when text is already parsed and blocks exist", () => {
    expect(
      shouldTriggerParseOnContinue({
        freeText: "5x5 squats @ 225",
        lastParsedText: "5x5 squats @ 225",
        hasBlocks: true,
      }),
    ).toBe(false);
  });

  it("returns true when text changed after the last successful parse", () => {
    expect(
      shouldTriggerParseOnContinue({
        freeText: "5x5 squats @ 235",
        lastParsedText: "5x5 squats @ 225",
        hasBlocks: true,
      }),
    ).toBe(true);
  });

  it("returns true when blocks are missing even if text is unchanged", () => {
    expect(
      shouldTriggerParseOnContinue({
        freeText: "5x5 squats @ 225",
        lastParsedText: "5x5 squats @ 225",
        hasBlocks: false,
      }),
    ).toBe(true);
  });

  it("returns false when there is no text to parse", () => {
    expect(
      shouldTriggerParseOnContinue({
        freeText: "   ",
        lastParsedText: "",
        hasBlocks: false,
      }),
    ).toBe(false);
  });

  it("guards against stale blocks after Capture remounts", () => {
    expect(
      shouldTriggerParseOnContinue({
        freeText: "edited text after failed parse",
        lastParsedText: "",
        hasBlocks: true,
      }),
    ).toBe(true);
  });
});
