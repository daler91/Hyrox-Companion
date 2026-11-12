import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ db: {} }));
vi.mock("./recycleBinCapture", () => ({ captureWorkoutLogs: vi.fn() }));

import { db } from "../db";
import { makeQueryBuilderMock } from "./__tests__/queryBuilderMock";
import {
  binWorkoutLogs,
  createHealthConnectWorkoutLogs,
  findUntouchedHealthConnectLogIds,
  getExistingHealthConnectIds,
  listUntouchedHealthConnectLogsForDates,
} from "./healthConnectLogs";
import { captureWorkoutLogs } from "./recycleBinCapture";

// The SQL itself runs against a real Postgres only in integration tests; this
// pins the empty-input short-circuits, the id merging, and the "untouched"
// and ownership filters each query carries.
const makeDb = () =>
  makeQueryBuilderMock(["select", "from", "where", "insert", "values", "onConflictDoNothing", "returning", "delete"]);

const dialect = new PgDialect();
const whereSql = (mock: ReturnType<typeof makeDb>, call = 0) =>
  dialect.sqlToQuery(mock.where.mock.calls[call][0] as SQL);

describe("healthConnectLogs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("answers empty input without a query", async () => {
    const mock = makeDb();
    Object.assign(db, mock, { transaction: vi.fn() });

    expect(await createHealthConnectWorkoutLogs([])).toEqual([]);
    expect(await getExistingHealthConnectIds("u1", [])).toEqual([]);
    expect(await listUntouchedHealthConnectLogsForDates("u1", [])).toEqual([]);
    expect(await findUntouchedHealthConnectLogIds("u1", [])).toEqual([]);
    expect(await binWorkoutLogs("u1", [])).toBe(0);

    expect(mock.select).not.toHaveBeenCalled();
    expect(mock.insert).not.toHaveBeenCalled();
    expect((db as unknown as { transaction: ReturnType<typeof vi.fn> }).transaction).not.toHaveBeenCalled();
  });

  describe("getExistingHealthConnectIds", () => {
    it("merges live and recycle-bin ids into one de-duplicated list, dropping null ids", async () => {
      const mock = makeDb();
      mock.queue(
        [{ id: "hc-1" }, { id: null }, { id: "hc-2" }], // live logs
        [{ id: "hc-2" }, { id: "hc-3" }], // binned, not yet expired
      );
      Object.assign(db, mock);

      const ids = await getExistingHealthConnectIds("u1", ["hc-1", "hc-2", "hc-3", "hc-4"]);

      expect(ids.sort()).toEqual(["hc-1", "hc-2", "hc-3"]);
    });

    it("counts a binned import only while it is still restorable, and only the athlete's own", async () => {
      const mock = makeDb();
      mock.queue([], []);
      Object.assign(db, mock);

      await getExistingHealthConnectIds("u1", ["hc-1"]);

      const binned = whereSql(mock, 1);
      expect(binned.sql).toContain('"recycle_bin_items"."user_id" = $1');
      expect(binned.sql).toContain('"recycle_bin_items"."expires_at" >');
      expect(binned.params[0]).toBe("u1");
      expect(whereSql(mock, 0).sql).toContain('"workout_logs"."user_id" = $1');
    });
  });

  it.each([
    ["listUntouchedHealthConnectLogsForDates", () => listUntouchedHealthConnectLogsForDates("u1", ["2026-11-08"])],
    ["findUntouchedHealthConnectLogIds", () => findUntouchedHealthConnectLogIds("u1", ["hc-1"])],
  ])("%s leaves alone an import the athlete took over (plan day or own RPE)", async (_label, run) => {
    const mock = makeDb();
    mock.queue([]);
    Object.assign(db, mock);

    await run();

    const where = whereSql(mock);
    expect(where.sql).toContain('"workout_logs"."user_id" = $1');
    expect(where.sql).toContain('"workout_logs"."plan_day_id" is null');
    expect(where.sql).toContain('"workout_logs"."rpe" is null');
    expect(where.params[0]).toBe("u1");
  });

  it("findUntouchedHealthConnectLogIds returns the matching log ids", async () => {
    const mock = makeDb();
    mock.queue([{ id: "log-1" }, { id: "log-2" }]);
    Object.assign(db, mock);

    expect(await findUntouchedHealthConnectLogIds("u1", ["hc-1", "hc-2"])).toEqual(["log-1", "log-2"]);
  });

  describe("binWorkoutLogs", () => {
    it("captures the logs into the recycle bin before deleting them, and reports how many were deleted", async () => {
      const tx = makeDb();
      tx.queue([{ id: "log-1" }]);
      Object.assign(db, { transaction: (fn: (t: unknown) => unknown) => fn(tx) });

      const deleted = await binWorkoutLogs("u1", ["log-1", "log-gone"]);

      expect(deleted).toBe(1);
      expect(captureWorkoutLogs).toHaveBeenCalledWith(tx, "u1", ["log-1", "log-gone"], {
        batchId: expect.any(String),
      });
      expect(vi.mocked(captureWorkoutLogs).mock.invocationCallOrder[0]).toBeLessThan(
        tx.delete.mock.invocationCallOrder[0],
      );
    });

    it("deletes only the athlete's own logs", async () => {
      const tx = makeDb();
      tx.queue([]);
      Object.assign(db, { transaction: (fn: (t: unknown) => unknown) => fn(tx) });

      expect(await binWorkoutLogs("u1", ["someone-elses-log"])).toBe(0);

      const where = whereSql(tx);
      expect(where.sql).toBe('("workout_logs"."user_id" = $1 and "workout_logs"."id" in ($2))');
      expect(where.params).toEqual(["u1", "someone-elses-log"]);
    });
  });
});
