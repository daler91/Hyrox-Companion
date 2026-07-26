import {
  type InsertPlanAdjustmentProposal,
  type PlanAdjustmentProposal,
  planAdjustmentProposals,
  type PlanProposalStatus,
} from "@shared/schema";
import { and, eq } from "drizzle-orm";

import { db, type DbExecutor } from "../db";

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
    return db.transaction(async (tx) => {
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

  /**
   * Move a pending proposal to a terminal status. Returns the updated row, or
   * undefined when the proposal wasn't pending anymore (lost a resolve race,
   * was superseded, or doesn't belong to this user).
   */
  async resolve(
    id: string,
    userId: string,
    status: Exclude<PlanProposalStatus, "pending">,
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
}
