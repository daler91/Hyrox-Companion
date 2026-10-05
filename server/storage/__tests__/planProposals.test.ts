import { planAdjustmentProposals } from "@shared/schema";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../../db";
import { PlanProposalStorage } from "../planProposals";

vi.mock("../../db", () => {
  const db: Record<string, unknown> = { select: vi.fn(), transaction: vi.fn() };
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

describe("PlanProposalStorage.getPending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the newest pending proposal, ties broken by id", async () => {
    const row = { id: "proposal-2", status: "pending" };
    const limit = vi.fn().mockResolvedValue([row]);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    vi.mocked(db.select).mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where }) } as never);

    await expect(new PlanProposalStorage().getPending("user-1")).resolves.toBe(row);

    const ordering = orderBy.mock.calls.at(0)?.map((term: SQL) => dialect.sqlToQuery(term).sql);
    expect(ordering).toEqual([
      '"plan_adjustment_proposals"."created_at" desc',
      '"plan_adjustment_proposals"."id" desc',
    ]);
    expect(limit).toHaveBeenCalledWith(1);
  });

  it("returns undefined when nothing is pending", async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    vi.mocked(db.select).mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where }) } as never);

    await expect(new PlanProposalStorage().getPending("user-1")).resolves.toBeUndefined();
  });
});
