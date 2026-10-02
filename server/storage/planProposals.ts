import {
  type InsertPlanAdjustmentProposal,
  type PlanAdjustmentProposal,
  planAdjustmentProposals,
  type PlanProposalApplyUndo,
  type PlanProposalStatus,
} from "@shared/schema";
import { and, desc, eq, gte, inArray } from "drizzle-orm";

import { db, type DbExecutor } from "../db";

/**
 * The athlete's proposals applied since `since`, the ones undone since
 * included, newest first: the coach's record of what it changed
 * (services/recentPlanChanges).
 */
async function getRecentlyAppliedProposals(
  userId: string,
  since: Date,
  limit: number,
): Promise<PlanAdjustmentProposal[]> {
  return await db
    .select()
    .from(planAdjustmentProposals)
    .where(
      and(
        eq(planAdjustmentProposals.userId, userId),
        inArray(planAdjustmentProposals.status, ["applied", "reverted"]),
        gte(planAdjustmentProposals.resolvedAt, since),
      ),
    )
    .orderBy(desc(planAdjustmentProposals.resolvedAt))
    .limit(limit);
}

/** The athlete's proposals among `ids`: the chat history and the coach's conversation read their outcomes. */
async function getProposalsByIds(ids: readonly string[], userId: string): Promise<PlanAdjustmentProposal[]> {
  if (ids.length === 0) return [];
  return await db
    .select()
    .from(planAdjustmentProposals)
    .where(
      and(
        inArray(planAdjustmentProposals.id, [...ids]),
        eq(planAdjustmentProposals.userId, userId),
      ),
    );
}

/**
 * Mark a pending proposal applied, with what the apply wrote so it can be
 * undone. Guarded like PlanProposalStorage.resolve: undefined when it wasn't
 * pending.
 */
async function markProposalApplied(
  id: string,
  userId: string,
  applyUndo: PlanProposalApplyUndo,
  tx?: DbExecutor,
): Promise<PlanAdjustmentProposal | undefined> {
  const executor = tx ?? db;
  const [row] = await executor
    .update(planAdjustmentProposals)
    .set({ status: "applied", resolvedAt: new Date(), applyUndo })
    .where(
      and(
        eq(planAdjustmentProposals.id, id),
        eq(planAdjustmentProposals.userId, userId),
        eq(planAdjustmentProposals.status, "pending"),
      ),
    )
    .returning();
  return row;
}

/**
 * Mark an applied proposal undone. Undefined when it wasn't applied anymore
 * (a concurrent undo won), so the losing undo's transaction rolls back.
 */
async function markProposalReverted(
  id: string,
  userId: string,
  tx?: DbExecutor,
): Promise<PlanAdjustmentProposal | undefined> {
  const executor = tx ?? db;
  const [row] = await executor
    .update(planAdjustmentProposals)
    .set({ status: "reverted", revertedAt: new Date() })
    .where(
      and(
        eq(planAdjustmentProposals.id, id),
        eq(planAdjustmentProposals.userId, userId),
        eq(planAdjustmentProposals.status, "applied"),
      ),
    )
    .returning();
  return row;
}

/**
 * Conversational plan-adjustment proposals. Invariant: at most one `pending`
 * proposal per user — creating a new one supersedes any pending predecessor
 * in the same transaction, and `resolve` is guarded by `status='pending'` so
 * concurrent apply/dismiss races lose cleanly (rowCount 0) instead of
 * double-writing.
 */
export class PlanProposalStorage {
  async create(
    proposal: Omit<InsertPlanAdjustmentProposal, "id" | "status" | "createdAt" | "resolvedAt">,
  ): Promise<PlanAdjustmentProposal> {
    return await db.transaction(async (tx) => {
      await tx
        .update(planAdjustmentProposals)
        .set({ status: "superseded", resolvedAt: new Date() })
        .where(
          and(
            eq(planAdjustmentProposals.userId, proposal.userId),
            eq(planAdjustmentProposals.status, "pending"),
          ),
        );
      const [row] = await tx.insert(planAdjustmentProposals).values(proposal).returning();
      return row;
    });
  }

  async getPending(userId: string): Promise<PlanAdjustmentProposal | undefined> {
    const [row] = await db
      .select()
      .from(planAdjustmentProposals)
      .where(
        and(
          eq(planAdjustmentProposals.userId, userId),
          eq(planAdjustmentProposals.status, "pending"),
        ),
      )
      .limit(1);
    return row;
  }

  async getById(id: string, userId: string): Promise<PlanAdjustmentProposal | undefined> {
    const [row] = await db
      .select()
      .from(planAdjustmentProposals)
      .where(
        and(eq(planAdjustmentProposals.id, id), eq(planAdjustmentProposals.userId, userId)),
      )
      .limit(1);
    return row;
  }

  // Uses no instance state, so it is a module function bound here, as
  // NutritionStorage binds its own: storage.planProposals.getByIds() and its
  // mocks still work.
  readonly getByIds = getProposalsByIds;

  readonly getRecentlyApplied = getRecentlyAppliedProposals;

  /**
   * Move a pending proposal to a terminal status. Returns the updated row, or
   * undefined when the proposal wasn't pending anymore (lost a resolve race,
   * was superseded, or doesn't belong to this user).
   */
  async resolve(
    id: string,
    userId: string,
    status: Exclude<PlanProposalStatus, "pending" | "applied" | "reverted">,
    tx?: DbExecutor,
  ): Promise<PlanAdjustmentProposal | undefined> {
    const executor = tx ?? db;
    const [row] = await executor
      .update(planAdjustmentProposals)
      .set({ status, resolvedAt: new Date() })
      .where(
        and(
          eq(planAdjustmentProposals.id, id),
          eq(planAdjustmentProposals.userId, userId),
          eq(planAdjustmentProposals.status, "pending"),
        ),
      )
      .returning();
    return row;
  }

  // Neither uses the instance, so they are module functions bound here, like
  // getByIds: storage.planProposals.markApplied() and its mocks still work.
  readonly markApplied = markProposalApplied;
  readonly markReverted = markProposalReverted;
}
