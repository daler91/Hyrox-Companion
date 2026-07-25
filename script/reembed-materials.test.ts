import { describe, expect, it } from "vitest";

import { parseFlags } from "./reembed-materials";

describe("reembed-materials flag parsing", () => {
  it("defaults to a live, fleet-wide rebuild", () => {
    expect(parseFlags([])).toEqual({ dryRun: false, verifyOnly: false });
  });

  it("parses each flag and combinations", () => {
    expect(parseFlags(["--dry-run"])).toMatchObject({ dryRun: true, verifyOnly: false });
    expect(parseFlags(["--verify-only"])).toMatchObject({ dryRun: false, verifyOnly: true });
    expect(parseFlags(["--user", "user_123"])).toMatchObject({ userId: "user_123" });
    expect(parseFlags(["--user", "user_123", "--dry-run"])).toMatchObject({ userId: "user_123", dryRun: true });
  });

  it("rejects a near-miss instead of silently starting a live rebuild", () => {
    // The failure mode this guards: an operator types `--dryrun`, the flag is
    // ignored, and a fleet-wide re-embed runs for real against production.
    expect(() => parseFlags(["--dryrun"])).toThrow(/Unknown flag: --dryrun/);
    expect(() => parseFlags(["--dry_run"])).toThrow(/Unknown flag/);
    expect(() => parseFlags(["--verify"])).toThrow(/Unknown flag/);
  });

  it("rejects --user with no value rather than treating the next flag as an id", () => {
    expect(() => parseFlags(["--user"])).toThrow(/--user needs an athlete id/);
    // `--user --dry-run` would otherwise scope the run to an athlete named
    // "--dry-run" — zero materials, a green summary, and nothing rebuilt.
    expect(() => parseFlags(["--user", "--dry-run"])).toThrow(/--user needs an athlete id/);
  });
});
