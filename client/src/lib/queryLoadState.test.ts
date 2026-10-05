import { describe, expect, it } from "vitest";

import { queryLoadState } from "./queryLoadState";

// U5 (CODEBASE_ANALYSIS_2026-10-03): having no data is loading or failed,
// never an empty account.
describe("queryLoadState", () => {
  it.each([
    ["a first fetch in flight", 0, "fetching", { loading: true, failed: false, retrying: false }],
    [
      "a first fetch paused offline",
      0,
      "paused",
      { loading: true, failed: false, retrying: false },
    ],
    ["a failed fetch", 1, "idle", { loading: false, failed: true, retrying: false }],
    ["a retry in flight", 1, "fetching", { loading: false, failed: true, retrying: true }],
    ["a retry waiting offline", 2, "paused", { loading: false, failed: true, retrying: true }],
  ] as const)("reads %s without data", (_name, errorUpdateCount, fetchStatus, expected) => {
    expect(queryLoadState({ data: undefined, errorUpdateCount, fetchStatus })).toEqual(expected);
  });

  it("reads any data, empty or from a placeholder, as answered even after a failure", () => {
    const answered = { loading: false, failed: false, retrying: false };
    expect(queryLoadState({ data: [], errorUpdateCount: 0, fetchStatus: "idle" })).toEqual(
      answered,
    );
    expect(queryLoadState({ data: null, errorUpdateCount: 3, fetchStatus: "fetching" })).toEqual(
      answered,
    );
  });
});
