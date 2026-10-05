import { describe, expect, it } from "vitest";

import { parseBackfillFlags } from "./backfillCli";

describe("parseBackfillFlags", () => {
  it("defaults to a quiet-off dry run over every athlete", () => {
    expect(parseBackfillFlags([])).toEqual({ apply: false, quiet: false });
  });

  it("reads --apply and --quiet", () => {
    expect(parseBackfillFlags(["--apply", "--quiet"])).toEqual({ apply: true, quiet: true });
  });

  it("accepts --user-id with a separate value", () => {
    expect(parseBackfillFlags(["--user-id", "user_1", "--apply"])).toEqual({
      apply: true,
      quiet: false,
      userId: "user_1",
    });
  });

  // D29 (CODEBASE_ANALYSIS_2026-10-03): the `=` form used to be dropped,
  // widening a one-athlete --apply to every athlete.
  it("accepts --user-id=X", () => {
    expect(parseBackfillFlags(["--apply", "--user-id=user_1"]).userId).toBe("user_1");
  });

  it("throws on a valueless --user-id", () => {
    expect(() => parseBackfillFlags(["--user-id"])).toThrow("--user-id needs a value");
    expect(() => parseBackfillFlags(["--user-id="])).toThrow("--user-id needs a value");
    expect(() => parseBackfillFlags(["--user-id", "--apply"])).toThrow("--user-id needs a value");
  });

  it("throws on an unknown flag or stray argument", () => {
    expect(() => parseBackfillFlags(["--aply"])).toThrow("Unknown argument: --aply");
    expect(() => parseBackfillFlags(["user_1"])).toThrow("Unknown argument: user_1");
  });

  it("steps over a script's own value flags", () => {
    expect(parseBackfillFlags(["--revert", "ids.json", "--apply"], ["--revert"])).toEqual({
      apply: true,
      quiet: false,
    });
  });
});
