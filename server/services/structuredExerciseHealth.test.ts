import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  db: { execute: vi.fn(), insert: vi.fn() },
}));

import { db } from "../db";
import { logger } from "../logger";
import { runStructuredExerciseDailyRollup } from "./structuredExerciseHealth";

describe("runStructuredExerciseDailyRollup", () => {
  let onConflictDoUpdateMock: ReturnType<typeof vi.fn>;
  let valuesMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // resetAllMocks (not clearAllMocks): each test queues its own
    // mockResolvedValueOnce sequence on db.execute, and clearAllMocks alone
    // leaves an unconsumed previous test's queued values in place, shifting
    // every later call by one.
    vi.resetAllMocks();
    onConflictDoUpdateMock = vi.fn().mockResolvedValue(undefined);
    valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictDoUpdateMock });
    vi.mocked(db.insert).mockReturnValue({ values: valuesMock } as never); // NOSONAR partial Drizzle query-builder mock
  });

  // The four db.execute() calls run in this fixed order: the day's row totals,
  // the week-over-week percentage comparison, the rejected-write count, and
  // the legacy breakdown by owner/source. A fifth (the stale-counter delete)
  // always runs after those, and a sixth (the batched re-insert) runs only
  // when there is something to insert.
  function mockExecuteSequence({
    rowResult = { rows: [{ total_rows: 0, structured_rows: 0, legacy_only_rows: 0, failed_hydration_backlog: 0 }] },
    wowResult = { rows: [{ current_pct: 0, prev_pct: 0 }] },
    rejectedWrites = { rows: [{ total: 0 }] },
    legacyBreakdown = { rows: [] as { owner_type: string; source: string; legacy_count: number }[] },
  } = {}) {
    // Cast as never (matches this codebase's convention for partial
    // Drizzle/pg query-builder mocks): these stand in for QueryResult, which
    // also carries command/rowCount/oid/fields the code under test never reads.
    vi.mocked(db.execute)
      .mockResolvedValueOnce(rowResult as never)
      .mockResolvedValueOnce(wowResult as never)
      .mockResolvedValueOnce(rejectedWrites as never)
      .mockResolvedValueOnce(legacyBreakdown as never)
      .mockResolvedValueOnce({ rows: [] } as never) // stale-counter delete
      .mockResolvedValueOnce({ rows: [] } as never); // batched re-insert, if triggered
  }

  it("guards the legacy-only percentage against a division by zero on a day with no rows", async () => {
    mockExecuteSequence({
      rowResult: { rows: [{ total_rows: 0, structured_rows: 0, legacy_only_rows: 0, failed_hydration_backlog: 0 }] },
    });

    await runStructuredExerciseDailyRollup("2026-08-19");

    expect(valuesMock).toHaveBeenCalledWith(expect.objectContaining({ legacyOnlyPct: 0 }));
  });

  it("saves the computed legacy-only percentage for a day with rows", async () => {
    mockExecuteSequence({
      rowResult: { rows: [{ total_rows: 20, structured_rows: 15, legacy_only_rows: 5, failed_hydration_backlog: 2 }] },
    });

    await runStructuredExerciseDailyRollup("2026-08-19");

    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        totalRows: 20,
        structuredRows: 15,
        legacyOnlyRows: 5,
        failedHydrationBacklog: 2,
        legacyOnlyPct: 0.25,
      }),
    );
  });

  it("warns when the legacy-only percentage rises more than 10% week-over-week", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    mockExecuteSequence({ wowResult: { rows: [{ current_pct: 0.5, prev_pct: 0.4 }] } });

    await runStructuredExerciseDailyRollup("2026-08-19");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: "legacy_only_pct_wow_rise" }),
      expect.any(String),
    );
  });

  it("does not warn when there is no prior week to compare against", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    // prevPct === 0 means "no history yet", not "100% improvement" — the
    // `prevPct > 0` guard exists specifically to skip this case.
    mockExecuteSequence({ wowResult: { rows: [{ current_pct: 0.9, prev_pct: 0 }] } });

    await runStructuredExerciseDailyRollup("2026-08-19");

    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: "legacy_only_pct_wow_rise" }),
      expect.any(String),
    );
  });

  it("does not warn when the rise is within the 10% tolerance", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    mockExecuteSequence({ wowResult: { rows: [{ current_pct: 0.42, prev_pct: 0.4 }] } });

    await runStructuredExerciseDailyRollup("2026-08-19");

    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: "legacy_only_pct_wow_rise" }),
      expect.any(String),
    );
  });

  it("warns when rejected text-only writes spike to 20 or more", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    mockExecuteSequence({ rejectedWrites: { rows: [{ total: 20 }] } });

    await runStructuredExerciseDailyRollup("2026-08-19");

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: "rejected_text_only_write_spike", rejectedTotal: 20 }),
      expect.any(String),
    );
  });

  it("does not warn when rejected text-only writes stay under the threshold", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    mockExecuteSequence({ rejectedWrites: { rows: [{ total: 19 }] } });

    await runStructuredExerciseDailyRollup("2026-08-19");

    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: "rejected_text_only_write_spike" }),
      expect.any(String),
    );
  });

  it("skips the batched re-insert entirely when the legacy breakdown is empty", async () => {
    mockExecuteSequence({ legacyBreakdown: { rows: [] } });

    await runStructuredExerciseDailyRollup("2026-08-19");

    // rowResult, wowResult, rejectedWrites, legacyBreakdown, and the stale
    // delete — five calls, with no sixth batched insert.
    expect(db.execute).toHaveBeenCalledTimes(5);
  });

  it("filters out zero and null legacy counts before batching the re-insert", async () => {
    mockExecuteSequence({
      legacyBreakdown: {
        rows: [
          { owner_type: "workout_log", source: "manual", legacy_count: 3 },
          { owner_type: "plan_day", source: "manual", legacy_count: 0 },
          { owner_type: "workout_log", source: "voice", legacy_count: null as unknown as number },
        ],
      },
    });

    await runStructuredExerciseDailyRollup("2026-08-19");

    // Only the row with a positive count triggers the sixth (batched insert) call.
    expect(db.execute).toHaveBeenCalledTimes(6);
  });
});
