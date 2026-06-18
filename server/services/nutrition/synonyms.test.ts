import { describe, expect, it } from "vitest";

import { canonicalize } from "./synonyms";

describe("canonicalize", () => {
  it("maps registered synonyms (either direction) to a shared canonical id", () => {
    expect(canonicalize("courgette")).toBe(canonicalize("zucchini"));
    expect(canonicalize("yoghurt")).toBe(canonicalize("yogurt"));
    expect(canonicalize("cilantro")).toBe(canonicalize("coriander"));
    expect(canonicalize("beet")).toBe(canonicalize("beetroot"));
    expect(canonicalize("arugula")).toBe(canonicalize("rocket"));
  });

  it("returns the token itself when it has no synonym", () => {
    expect(canonicalize("banana")).toBe("banana");
    expect(canonicalize("chocolate")).toBe("chocolate");
  });

  it("does not conflate tokens from different groups", () => {
    expect(canonicalize("zucchini")).not.toBe(canonicalize("eggplant"));
    expect(canonicalize("yogurt")).not.toBe(canonicalize("banana"));
  });
});
