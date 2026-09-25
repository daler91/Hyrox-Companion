import { describe, expect, it } from "vitest";

import {
  ageInputToSnapshot,
  mafHrDataAvailableInputToSnapshot,
  mafHrDataAvailableToInput,
} from "./preferencesSnapshot";

describe("ageInputToSnapshot", () => {
  it("parses a whole-number input", () => {
    expect(ageInputToSnapshot("34")).toBe(34);
  });

  it("is null for empty or non-numeric input, so the field stays unset", () => {
    expect(ageInputToSnapshot("")).toBeNull();
    expect(ageInputToSnapshot("abc")).toBeNull();
  });
});

describe("mafHrDataAvailableInputToSnapshot", () => {
  it("reads the yes/no answer", () => {
    expect(mafHrDataAvailableInputToSnapshot("yes")).toBe(true);
    expect(mafHrDataAvailableInputToSnapshot("no")).toBe(false);
  });

  it("is null when the athlete hasn't answered", () => {
    expect(mafHrDataAvailableInputToSnapshot("")).toBeNull();
  });
});

describe("mafHrDataAvailableToInput", () => {
  it("renders the stored boolean back as yes/no", () => {
    expect(mafHrDataAvailableToInput(true)).toBe("yes");
    expect(mafHrDataAvailableToInput(false)).toBe("no");
  });

  it("is an empty (unanswered) input for null or undefined", () => {
    expect(mafHrDataAvailableToInput(null)).toBe("");
    expect(mafHrDataAvailableToInput(undefined)).toBe("");
  });
});
