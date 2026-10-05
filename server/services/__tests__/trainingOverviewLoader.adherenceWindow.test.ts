import { describe, expect, it, vi } from "vitest";

import { resolveAdherenceWindow } from "../trainingOverviewLoader";

vi.mock("../../storage", () => ({ storage: {} }));

// C37 (CODEBASE_ANALYSIS_2026-10-03): "All time" counted due sessions only up
// to the last log, so sessions missed after the athlete stopped logging never
// entered the denominator.
describe("resolveAdherenceWindow", () => {
  const logs = [{ date: "2026-06-05" }, { date: "2026-06-01" }, { date: "2026-06-08" }];

  it("keeps a selected range as it is", () => {
    expect(resolveAdherenceWindow("2026-04-01", "2026-06-30", logs, "2026-07-02")).toEqual({
      from: "2026-04-01",
      to: "2026-06-30",
    });
  });

  it("runs all time from the first log to the athlete's today, past the last log", () => {
    expect(resolveAdherenceWindow(undefined, undefined, logs, "2026-06-30")).toEqual({
      from: "2026-06-01",
      to: "2026-06-30",
    });
  });

  it("reaches a log dated past today, so its plan day stays due", () => {
    expect(resolveAdherenceWindow(undefined, undefined, logs, "2026-06-07")).toEqual({
      from: "2026-06-01",
      to: "2026-06-08",
    });
  });

  it("has no window without a log to start from", () => {
    expect(resolveAdherenceWindow(undefined, undefined, [], "2026-06-30")).toBeNull();
  });
});
