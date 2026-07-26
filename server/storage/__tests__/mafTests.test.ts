import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../../db";
import { MafTestStorage } from "../mafTests";

vi.mock("../../db", () => {
  const db: Record<string, unknown> = {
    delete: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  };
  // deleteTestForWorkout / updateTestWithAnalysis run their writes inside
  // db.transaction(tx => ...). The mocked transaction just invokes the callback
  // with the same `db` object so per-test db.* setups apply inside the
  // transaction.
  db.transaction = vi.fn((cb: (tx: typeof db) => Promise<unknown>) => cb(db));
  return { db };
});

// Two `delete(table).where(...)` calls run in order: first the analysis rows
// (result ignored), then the test rows (whose rowCount drives the boolean).
function mockDeletes(testRowCount: number | null) {
  const analysisWhere = vi.fn().mockResolvedValue({ rowCount: 0 });
  const testWhere = vi.fn().mockResolvedValue({ rowCount: testRowCount });
  vi.mocked(db.delete)
    .mockReturnValueOnce({ where: analysisWhere })
    .mockReturnValueOnce({ where: testWhere });
  return { analysisWhere, testWhere };
}

// Wire the update().set().where().returning() chain, the analysis delete, and
// the analysis insert().values().returning() chain so the transaction body
// resolves end to end. Assigning fresh mocks onto `db` (rather than casting
// db.* to a mock type) keeps the typed-mock references local and cast-free.
function mockChains(testRow: object, insertedAnalysis: object | null) {
  const updReturning = vi.fn().mockResolvedValue([testRow]);
  const updWhere = vi.fn().mockReturnValue({ returning: updReturning });
  const updSet = vi.fn().mockReturnValue({ where: updWhere });
  const update = vi.fn().mockReturnValue({ set: updSet });

  const delWhere = vi.fn().mockResolvedValue({ rowCount: 1 });
  const del = vi.fn().mockReturnValue({ where: delWhere });

  const insReturning = vi.fn().mockResolvedValue([insertedAnalysis ?? { id: "a1" }]);
  const insValues = vi.fn().mockReturnValue({ returning: insReturning });
  const insert = vi.fn().mockReturnValue({ values: insValues });

  Object.assign(db, { update, delete: del, insert });
  return { updSet, delWhere, insValues };
}

describe("MafTestStorage.deleteTestForWorkout", () => {
  let storage: MafTestStorage;

  beforeEach(() => {
    storage = new MafTestStorage();
    vi.clearAllMocks();
  });

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

describe("MafTestStorage.updateTestWithAnalysis", () => {
  let storage: MafTestStorage;

  beforeEach(() => {
    storage = new MafTestStorage();
    vi.clearAllMocks();
  });

  const metrics = {
    durationSeconds: 1710,
    distanceMeters: 5000,
    avgHeartRate: 140,
    maxHeartRate: 150,
    mafCeilingUsed: 145,
  };

  it("updates the test metrics and replaces the analysis in one transaction", async () => {
    const { updSet, delWhere, insValues } = mockChains({ id: "t1", metrics }, { id: "a1", compliancePct: 100 });

    const result = await storage.updateTestWithAnalysis(
      "u1",
      "w1",
      { metrics, protocolType: "fixed_time_run" },
      { userId: "u1", workoutLogId: "w1", compliancePct: 100, classification: "compliant", nextAction: "x", analysisDetails: {} },
    );

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(updSet).toHaveBeenCalledWith(expect.objectContaining({ metrics, protocolType: "fixed_time_run" }));
    expect(delWhere).toHaveBeenCalledTimes(1); // old analysis removed first
    expect(insValues).toHaveBeenCalledTimes(1); // recomputed analysis inserted
    expect(result.testResult).toMatchObject({ id: "t1" });
    expect(result.analysis).not.toBeNull();
  });

  it("removes the analysis without re-inserting when analysisData is null", async () => {
    const { delWhere, insValues } = mockChains({ id: "t1", metrics }, null);

    const result = await storage.updateTestWithAnalysis("u1", "w1", { metrics }, null);

    expect(delWhere).toHaveBeenCalledTimes(1);
    expect(insValues).not.toHaveBeenCalled();
    expect(result.analysis).toBeNull();
  });
});
