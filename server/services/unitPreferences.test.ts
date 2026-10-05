import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../db";
import { loadUnitPreferences } from "./unitPreferences";

vi.mock("../db", () => ({ db: { select: vi.fn() } }));

/** An executor whose user lookup finds `rows`. */
function executorFinding(rows: Array<{ weightUnit: string | null; distanceUnit: string | null }>) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  return { select: vi.fn(() => ({ from })) };
}

describe("loadUnitPreferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads on the transaction it is given, not through the pool", async () => {
    // D49 (CODEBASE_ANALYSIS_2026-10-03): read through the pool from inside a
    // save's transaction, each save held a connection while it waited for a
    // second one.
    const tx = executorFinding([{ weightUnit: "lbs", distanceUnit: "miles" }]);

    await expect(loadUnitPreferences("user-1", tx as never)).resolves.toEqual({
      weightUnit: "lbs",
      distanceUnit: "miles",
    });
    expect(tx.select).toHaveBeenCalledTimes(1);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("reads through the pool when no transaction is given", async () => {
    const pooled = executorFinding([{ weightUnit: "kg", distanceUnit: "km" }]);
    vi.mocked(db.select).mockImplementation(pooled.select as never);

    await expect(loadUnitPreferences("user-1")).resolves.toEqual({
      weightUnit: "kg",
      distanceUnit: "km",
    });
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it("falls back to the column defaults for a missing user or unset units", async () => {
    await expect(loadUnitPreferences("gone", executorFinding([]) as never)).resolves.toEqual({
      weightUnit: "kg",
      distanceUnit: "km",
    });
    await expect(
      loadUnitPreferences(
        "user-1",
        executorFinding([{ weightUnit: null, distanceUnit: null }]) as never,
      ),
    ).resolves.toEqual({ weightUnit: "kg", distanceUnit: "km" });
  });
});
