import type { PlanDayMoveKind } from "@shared/schema";

import { logger } from "../logger";
import { storage } from "../storage";

/** One session's move as its write path saw it: the date before the write and after it. */
export interface PlanDayMoveWrite {
  readonly planDayId: string;
  readonly fromDate: string | null | undefined;
  readonly toDate: string | null | undefined;
  readonly kind: PlanDayMoveKind;
}

/**
 * Record a move the athlete made themselves, for the coach's record of plan
 * changes (services/recentPlanChanges.ts). Only a dated session given another
 * date counts. Best effort: the move has already landed, so a failure here is
 * logged and the record just goes without it.
 */
export async function recordPlanDayMove(userId: string, move: PlanDayMoveWrite): Promise<void> {
  const { fromDate, toDate } = move;
  if (!fromDate || !toDate || fromDate === toDate) return;
  try {
    await storage.planDayMoves.record({ userId, planDayId: move.planDayId, fromDate, toDate, kind: move.kind });
  } catch (error) {
    // A storage error only; no plan content.
    // bearer:disable javascript_lang_logger_leak
    logger.warn({ err: error }, "[plan-day-moves] Could not record a move; the coach's record goes without it");
  }
}
