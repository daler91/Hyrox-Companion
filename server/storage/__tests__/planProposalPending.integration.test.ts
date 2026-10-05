import { planAdjustmentProposals, trainingPlans } from "@shared/schema";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db";
import { isUniqueViolation } from "../../dbErrors";
import { storage } from "../index";
import { resetIntegrationDb, seedUser } from "./integrationDb";

/**
 * One pending plan-adjustment proposal per athlete, against the REAL schema
 * (D51, CODEBASE_ANALYSIS_2026-10-03). Two coach turns that finish together
 * used to leave two pending, and GET /plan-proposals/pending answered with
 * either one.
 */
describe("one pending plan proposal per athlete (real Postgres)", () => {
  const ALICE = "pending-alice";
  const BOB = "pending-bob";

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(ALICE);
    await seedUser(BOB);
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  async function seedPlan(userId: string): Promise<string> {
    const [plan] = await db
      .insert(trainingPlans)
      .values({ userId, name: "Block", totalWeeks: 8 })
      .returning();
    return plan.id;
  }

  function proposalFor(userId: string, planId: string, summaryMessage: string) {
    return {
      userId,
      planId,
      summaryMessage,
      userRequest: "adjust my week",
      payload: { changes: [] },
    };
  }

  async function proposalsOf(userId: string) {
    return await db
      .select()
      .from(planAdjustmentProposals)
      .where(eq(planAdjustmentProposals.userId, userId))
      .orderBy(asc(planAdjustmentProposals.createdAt));
  }

  it("leaves exactly one pending when several creates race", async () => {
    const planId = await seedPlan(ALICE);

    const created = await Promise.all(
      ["one", "two", "three", "four", "five"].map((label) =>
        storage.planProposals.create(proposalFor(ALICE, planId, label)),
      ),
    );

    const rows = await proposalsOf(ALICE);
    expect(rows).toHaveLength(5);
    const pending = rows.filter((row) => row.status === "pending");
    expect(pending).toHaveLength(1);
    const superseded = rows.filter((row) => row.status === "superseded");
    expect(superseded).toHaveLength(4);
    expect(superseded.every((row) => row.resolvedAt !== null)).toBe(true);
    expect(created.map((row) => row.id)).toContain(pending.at(0)?.id);
    await expect(storage.planProposals.getPending(ALICE)).resolves.toMatchObject({
      id: pending.at(0)?.id,
    });
  });

  it("supersedes the earlier proposal on a sequential create", async () => {
    const planId = await seedPlan(ALICE);
    const first = await storage.planProposals.create(proposalFor(ALICE, planId, "first"));
    const second = await storage.planProposals.create(proposalFor(ALICE, planId, "second"));

    await expect(storage.planProposals.getById(first.id, ALICE)).resolves.toMatchObject({
      status: "superseded",
    });
    await expect(storage.planProposals.getPending(ALICE)).resolves.toMatchObject({ id: second.id });
  });

  it("keeps each athlete's pending proposal apart", async () => {
    const [alicePlan, bobPlan] = await Promise.all([seedPlan(ALICE), seedPlan(BOB)]);
    const [aliceProposal, bobProposal] = await Promise.all([
      storage.planProposals.create(proposalFor(ALICE, alicePlan, "alice")),
      storage.planProposals.create(proposalFor(BOB, bobPlan, "bob")),
    ]);

    await expect(storage.planProposals.getPending(ALICE)).resolves.toMatchObject({
      id: aliceProposal.id,
    });
    await expect(storage.planProposals.getPending(BOB)).resolves.toMatchObject({
      id: bobProposal.id,
    });
  });

  it("rejects a second pending row written past the storage layer", async () => {
    const planId = await seedPlan(ALICE);
    await storage.planProposals.create(proposalFor(ALICE, planId, "first"));

    const error = await db
      .insert(planAdjustmentProposals)
      .values(proposalFor(ALICE, planId, "second"))
      .then(
        () => null,
        (err: unknown) => err,
      );

    expect(isUniqueViolation(error, "uq_plan_adjustment_proposals_user_pending")).toBe(true);
  });

  it("allows any number of resolved proposals beside the pending one", async () => {
    const planId = await seedPlan(ALICE);
    await db.insert(planAdjustmentProposals).values([
      { ...proposalFor(ALICE, planId, "dismissed"), status: "dismissed" },
      { ...proposalFor(ALICE, planId, "applied"), status: "applied" },
      { ...proposalFor(ALICE, planId, "superseded"), status: "superseded" },
    ]);
    const pending = await storage.planProposals.create(proposalFor(ALICE, planId, "pending"));

    const rows = await proposalsOf(ALICE);
    expect(rows.map((row) => row.status).sort()).toEqual([
      "applied",
      "dismissed",
      "pending",
      "superseded",
    ]);
    await expect(storage.planProposals.getPending(ALICE)).resolves.toMatchObject({
      id: pending.id,
    });
  });
});
