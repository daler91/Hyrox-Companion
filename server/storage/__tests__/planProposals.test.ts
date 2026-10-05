import { planAdjustmentProposals } from "@shared/schema";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../../db";
import { PlanProposalStorage } from "../planProposals";

vi.mock("../../db", () => {
  const db: Record<string, unknown> = { select: vi.fn(), update: vi.fn(), transaction: vi.fn() };
  return { db };
});

// D51 (CODEBASE_ANALYSIS_2026-10-03): one pending proposal per athlete. The
// real-Postgres race lives in planProposalPending.integration.test.ts; these
// pin the query shapes that hold it.

const dialect = new PgDialect();

const PROPOSAL = {
  userId: "user-1",
  planId: "plan-1",
  summaryMessage: "Swap Thursday's run for rest",
  userRequest: "my knee hurts",
  payload: { changes: [] },
};

/** A transaction that logs every statement, in order, so lock ordering can be asserted. */
function fakeTx() {
  const log: string[] = [];
  const executed: SQL[] = [];
  const inserted = { id: "proposal-2", status: "pending" };
  const tx = {
    execute: vi.fn((query: SQL) => {
      log.push("execute");
      executed.push(query);
      return Promise.resolve({ rows: [] });
    }),
    update: vi.fn((table: unknown) => {
      log.push(table === planAdjustmentProposals ? "update proposals" : "update ?");
      const where = vi.fn().mockResolvedValue([]);
      return { set: vi.fn().mockReturnValue({ where }) };
    }),
    insert: vi.fn((table: unknown) => {
      log.push(table === planAdjustmentProposals ? "insert proposals" : "insert ?");
      const returning = vi.fn().mockResolvedValue([inserted]);
      return { values: vi.fn().mockReturnValue({ returning }) };
    }),
  };
  vi.mocked(db.transaction).mockImplementationOnce(((
    run: (client: typeof tx) => Promise<unknown>,
  ) => run(tx)) as never);
  return { tx, log, executed, inserted };
}

describe("PlanProposalStorage.create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("takes the athlete's advisory lock before superseding and inserting", async () => {
    const { log, executed, inserted } = fakeTx();

    await expect(new PlanProposalStorage().create(PROPOSAL as never)).resolves.toBe(inserted);

    expect(log).toEqual(["execute", "update proposals", "insert proposals"]);
    const query = dialect.sqlToQuery(executed[0]);
    expect(query.sql).toContain("pg_advisory_xact_lock(hashtextextended(");
    expect(query.params).toEqual(["plan_proposals:user-1"]);
  });
});

/** Mock the pending read: select().from().innerJoin().where().orderBy().limit(). */
function mockPendingRead(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy });
  const innerJoin = vi.fn().mockReturnValue({ where });
  vi.mocked(db.select).mockReturnValueOnce({
    from: vi.fn().mockReturnValue({ innerJoin }),
  } as never);
  return { orderBy, limit };
}

/** Mock resolve()'s guarded update, recording the status it writes. */
function mockResolveUpdate() {
  const set = vi.fn((values: unknown) => ({
    where: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: "proposal-2", ...(values as object) }]),
    }),
  }));
  vi.mocked(db.update).mockReturnValueOnce({ set } as never);
  return set;
}

/** A pending proposal changing one day, dated by its baseline or moved by the change. */
function pendingRow(change: { baselineDate: string; movesTo?: string }, userTimezone = "UTC") {
  return {
    proposal: {
      id: "proposal-2",
      status: "pending",
      payload: {
        changes: [
          {
            planDayId: "day-1",
            updatedFields: change.movesTo ? { scheduledDate: change.movesTo } : { expectedRpe: 6 },
            baseline: { scheduledDate: change.baselineDate },
          },
        ],
      },
    },
    userTimezone,
  };
}

describe("PlanProposalStorage.getPending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the newest pending proposal, ties broken by id", async () => {
    const row = {
      proposal: { id: "proposal-2", status: "pending", payload: { changes: [] } },
      userTimezone: "UTC",
    };
    const { orderBy, limit } = mockPendingRead([row]);

    await expect(new PlanProposalStorage().getPending("user-1")).resolves.toBe(row.proposal);

    const ordering = orderBy.mock.calls.at(0)?.map((term: SQL) => dialect.sqlToQuery(term).sql);
    expect(ordering).toEqual([
      '"plan_adjustment_proposals"."created_at" desc',
      '"plan_adjustment_proposals"."id" desc',
    ]);
    expect(limit).toHaveBeenCalledWith(1);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("returns undefined when nothing is pending", async () => {
    mockPendingRead([]);

    await expect(new PlanProposalStorage().getPending("user-1")).resolves.toBeUndefined();
  });

  // C33 (CODEBASE_ANALYSIS_2026-10-03): a proposal never expired, so applying
  // it days later could put a session on a date that had already passed.
  describe("a proposal whose days have passed (C33)", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-05T02:00:00Z"));
    });

    it.each([
      { label: "changes a day that has passed", change: { baselineDate: "2026-10-04" } },
      {
        label: "moves a day onto one that has passed",
        change: { baselineDate: "2026-10-08", movesTo: "2026-10-04" },
      },
    ])("is resolved invalidated, not offered, when it $label", async ({ change }) => {
      mockPendingRead([pendingRow(change)]);
      const set = mockResolveUpdate();

      await expect(new PlanProposalStorage().getPending("user-1")).resolves.toBeUndefined();

      expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: "invalidated" }));
    });

    it("stays pending while every day is today or later", async () => {
      const row = pendingRow({ baselineDate: "2026-10-05", movesTo: "2026-10-07" });
      mockPendingRead([row]);

      await expect(new PlanProposalStorage().getPending("user-1")).resolves.toBe(row.proposal);
      expect(db.update).not.toHaveBeenCalled();
    });

    it("judges 'passed' on the athlete's own calendar", async () => {
      // 02:00 UTC on the 5th is still the evening of the 4th in Los Angeles.
      const row = pendingRow({ baselineDate: "2026-10-04" }, "America/Los_Angeles");
      mockPendingRead([row]);

      await expect(new PlanProposalStorage().getPending("user-1")).resolves.toBe(row.proposal);
      expect(db.update).not.toHaveBeenCalled();
    });
  });
});
