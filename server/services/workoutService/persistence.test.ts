import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../../db";
import { logger } from "../../logger";
import { saveParsedWorkoutsBatch } from "./persistence";

// The transaction handle is a DISTINCT object from `db`, so a test can tell
// whether a statement ran inside the transaction or on the bare connection.
const tx = { delete: vi.fn(), insert: vi.fn() };

vi.mock("../../db", () => ({
  db: {
    delete: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  },
}));
vi.mock("../../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/**
 * `saveParsedWorkoutsBatch` replaces the sets of a whole reparse chunk with one
 * DELETE and one INSERT. Its comment claimed a single transaction; the code ran
 * the two as separate statements, with only the insert inside a try/catch.
 *
 * The insert is one multi-row statement across the chunk, so a single rejected
 * row (a CHECK violation from a misparse) fails it for every workout in the
 * chunk — and with the delete already committed, those workouts were left with
 * no sets and the function returned `failed`, having destroyed rows it could
 * not put back. `batchReparseWorkouts` snapshots "workouts with no sets" once
 * and then spends minutes on AI parses, so a workout the athlete logged into
 * during that window is exactly what the delete would have removed.
 */

function mockTransaction() {
  tx.delete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  tx.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
  vi.mocked(db.transaction).mockImplementation(
    (async (cb: (handle: typeof tx) => Promise<unknown>) => cb(tx)) as never,
  );
}

const CHUNK = [
  { workoutId: "w-1", setRows: [{ workoutLogId: "w-1", exerciseName: "back_squat" }] },
  { workoutId: "w-2", setRows: [{ workoutLogId: "w-2", exerciseName: "run_1k" }] },
] as unknown as Parameters<typeof saveParsedWorkoutsBatch>[0];

describe("saveParsedWorkoutsBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransaction();
  });

  it("runs the delete and the insert inside one transaction", async () => {
    const result = await saveParsedWorkoutsBatch(CHUNK);

    expect(result).toEqual({ saved: 2, failed: 0 });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(tx.delete).toHaveBeenCalledTimes(1);
    expect(tx.insert).toHaveBeenCalledTimes(1);
    // Neither statement may run on the bare connection: a delete that commits
    // on its own is the whole defect.
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("does not commit the delete when the insert fails", async () => {
    tx.insert.mockReturnValue({ values: vi.fn().mockRejectedValue(new Error("violates check constraint")) });

    const result = await saveParsedWorkoutsBatch(CHUNK);

    expect(result).toEqual({ saved: 0, failed: 2 });
    // The delete has to have been part of the failed transaction, so the driver
    // rolls it back. On the bare connection it would already be committed.
    expect(tx.delete).toHaveBeenCalledTimes(1);
    expect(db.delete).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("still opens a transaction when the chunk parsed to no rows at all", async () => {
    // An empty INSERT is skipped, but the DELETE must not therefore run bare.
    const result = await saveParsedWorkoutsBatch([
      { workoutId: "w-1", setRows: [] },
    ]);

    expect(result).toEqual({ saved: 1, failed: 0 });
    expect(tx.delete).toHaveBeenCalledTimes(1);
    expect(tx.insert).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("touches nothing for an empty chunk", async () => {
    expect(await saveParsedWorkoutsBatch([])).toEqual({ saved: 0, failed: 0 });
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
