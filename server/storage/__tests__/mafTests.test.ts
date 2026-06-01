import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../../db";
import { MafTestStorage } from "../mafTests";

vi.mock("../../db", () => {
  const db: Record<string, unknown> = {
    delete: vi.fn(),
  };
  // deleteTestForWorkout runs its two deletes inside db.transaction(tx => ...).
  // The mocked transaction just invokes the callback with the same `db` object
  // so per-test db.delete setups continue to apply inside the transaction.
  db.transaction = vi.fn((cb: (tx: typeof db) => Promise<unknown>) => cb(db));
  return { db };
});

describe("MafTestStorage.deleteTestForWorkout", () => {
  let storage: MafTestStorage;

  beforeEach(() => {
    storage = new MafTestStorage();
    vi.clearAllMocks();
  });

  // Two `delete(table).where(...)` calls run in order: first the analysis rows
  // (result ignored), then the test rows (whose rowCount drives the boolean).
  function mockDeletes(testRowCount: number | null) {
    const analysisWhere = vi.fn().mockResolvedValue({ rowCount: 0 });
    const testWhere = vi.fn().mockResolvedValue({ rowCount: testRowCount });
    (db.delete as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({ where: analysisWhere })
      .mockReturnValueOnce({ where: testWhere });
    return { analysisWhere, testWhere };
  }

  it("deletes analysis then test rows in one transaction and returns true when a test was removed", async () => {
    const { analysisWhere, testWhere } = mockDeletes(1);

    const result = await storage.deleteTestForWorkout("u1", "w1");

    expect(result).toBe(true);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.delete).toHaveBeenCalledTimes(2);
    expect(analysisWhere).toHaveBeenCalledTimes(1);
    expect(testWhere).toHaveBeenCalledTimes(1);
  });

  it("returns false when the workout wasn't tagged (no test row deleted)", async () => {
    mockDeletes(0);

    const result = await storage.deleteTestForWorkout("u1", "w1");

    expect(result).toBe(false);
  });

  it("returns false when the driver reports a null rowCount", async () => {
    mockDeletes(null);

    const result = await storage.deleteTestForWorkout("u1", "w1");

    expect(result).toBe(false);
  });
});
