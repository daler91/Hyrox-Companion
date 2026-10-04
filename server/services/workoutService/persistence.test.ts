import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../../db";
import { logger } from "../../logger";
import { saveParsedWorkoutsBatch } from "./persistence";

// The transaction handle is a DISTINCT object from `db`, so a test can tell
// whether a statement ran inside the transaction or on the bare connection.
const tx = { select: vi.fn(), selectDistinct: vi.fn(), delete: vi.fn(), insert: vi.fn() };
const lockFor = vi.fn();
const insertValues = vi.fn();

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
 * `saveParsedWorkoutsBatch` writes the parsed sets of a whole reparse chunk
 * with one INSERT. `batchReparseWorkouts` snapshots "workouts with no sets"
 * once and then spends minutes on AI parses, so a workout the athlete logs
 * sets into during that window must keep those sets.
 *
 * It used to DELETE every set on the chunk's workouts and then insert, inside
 * one transaction. The transaction only protected the failure path: on a
 * successful insert the delete still removed the hand-logged rows and the AI's
 * guess replaced them (D17, CODEBASE_ANALYSIS_2026-10-03). It now locks the
 * chunk's workout_logs rows, re-checks which still have no sets, and writes
 * only those.
 */

/** `lockedIds` are the workout_logs rows that still exist; `idsWithSets` the
 *  ones that have gained exercise sets since the snapshot. */
function mockTransaction({
  lockedIds = ["w-1", "w-2"],
  idsWithSets = [] as string[],
}: { lockedIds?: string[]; idsWithSets?: string[] } = {}) {
  lockFor.mockResolvedValue(lockedIds.map((id) => ({ id })));
  tx.select.mockReturnValue({
    from: () => ({ where: () => ({ orderBy: () => ({ for: lockFor }) }) }),
  });
  tx.selectDistinct.mockReturnValue({
    from: () => ({ where: vi.fn().mockResolvedValue(idsWithSets.map((workoutLogId) => ({ workoutLogId }))) }),
  });
  tx.delete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  insertValues.mockResolvedValue(undefined);
  tx.insert.mockReturnValue({ values: insertValues });
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

  it("locks the chunk's workouts and inserts inside one transaction", async () => {
    const result = await saveParsedWorkoutsBatch(CHUNK);

    expect(result).toEqual({ saved: 2, failed: 0, skipped: 0 });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(lockFor).toHaveBeenCalledWith("update");
    expect(tx.insert).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledWith([CHUNK[0].setRows[0], CHUNK[1].setRows[0]]);
    // Nothing may run on the bare connection.
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("never deletes existing sets", async () => {
    await saveParsedWorkoutsBatch(CHUNK);

    // Every workout in the chunk had no sets at snapshot time, so a delete can
    // only ever remove sets written since — the athlete's own.
    expect(tx.delete).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("skips a workout the athlete logged sets into after the snapshot", async () => {
    mockTransaction({ idsWithSets: ["w-2"] });

    const result = await saveParsedWorkoutsBatch(CHUNK);

    expect(result).toEqual({ saved: 1, failed: 0, skipped: 1 });
    expect(insertValues).toHaveBeenCalledWith([CHUNK[0].setRows[0]]);
    expect(tx.delete).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when every workout in the chunk has gained sets", async () => {
    mockTransaction({ idsWithSets: ["w-1", "w-2"] });

    const result = await saveParsedWorkoutsBatch(CHUNK);

    expect(result).toEqual({ saved: 0, failed: 0, skipped: 2 });
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.delete).not.toHaveBeenCalled();
  });

  it("skips a workout deleted since the snapshot instead of failing the chunk", async () => {
    // Its rows would fail the foreign key and take the whole multi-row insert
    // down with them.
    mockTransaction({ lockedIds: ["w-1"] });

    const result = await saveParsedWorkoutsBatch(CHUNK);

    expect(result).toEqual({ saved: 1, failed: 0, skipped: 1 });
    expect(insertValues).toHaveBeenCalledWith([CHUNK[0].setRows[0]]);
  });

  it("reports the chunk as failed when the insert is rejected", async () => {
    insertValues.mockRejectedValue(new Error("violates check constraint"));

    const result = await saveParsedWorkoutsBatch(CHUNK);

    expect(result).toEqual({ saved: 0, failed: 2, skipped: 0 });
    expect(tx.delete).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("counts a chunk that parsed to no rows as saved without inserting", async () => {
    const result = await saveParsedWorkoutsBatch([{ workoutId: "w-1", setRows: [] }]);

    expect(result).toEqual({ saved: 1, failed: 0, skipped: 0 });
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.delete).not.toHaveBeenCalled();
  });

  it("touches nothing for an empty chunk", async () => {
    expect(await saveParsedWorkoutsBatch([])).toEqual({ saved: 0, failed: 0, skipped: 0 });
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
