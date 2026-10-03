import { type PlanDayMoveKind, planDayMoves, planDays } from "@shared/schema";
import { and, desc, eq, gte, lt } from "drizzle-orm";

import { db } from "../db";

/** A move as its write path states it, once the write that made it has landed. */
export interface NewPlanDayMove {
  readonly userId: string;
  readonly planDayId: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly kind: PlanDayMoveKind;
}

/** A recorded move with the session's current name, as the coach's record lists it. */
export interface RecentPlanDayMove {
  readonly planDayId: string;
  readonly focus: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly kind: PlanDayMoveKind;
  readonly movedAt: Date;
}

/**
 * A drag the athlete corrects within this long is one move: Monday to
 * Wednesday, then Wednesday to Tuesday, reads as Monday to Tuesday, and a drag
 * put straight back leaves nothing.
 */
export const PLAN_DAY_MOVE_MERGE_MS = 15 * 60 * 1000;

async function recordMove(move: NewPlanDayMove, now: Date = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    // The day's latest move, locked so a second correction waits for this one.
    const [latest] = await tx
      .select({
        id: planDayMoves.id,
        kind: planDayMoves.kind,
        fromDate: planDayMoves.fromDate,
        toDate: planDayMoves.toDate,
      })
      .from(planDayMoves)
      .where(
        and(
          eq(planDayMoves.userId, move.userId),
          eq(planDayMoves.planDayId, move.planDayId),
          gte(planDayMoves.movedAt, new Date(now.getTime() - PLAN_DAY_MOVE_MERGE_MS)),
        ),
      )
      .orderBy(desc(planDayMoves.movedAt))
      .limit(1)
      .for("update");

    const correctsLatest =
      move.kind === "moved" && latest?.kind === "moved" && latest.toDate === move.fromDate;
    if (!correctsLatest) {
      await tx.insert(planDayMoves).values({ ...move, movedAt: now });
      return;
    }
    if (latest.fromDate === move.toDate) {
      await tx.delete(planDayMoves).where(eq(planDayMoves.id, latest.id));
      return;
    }
    await tx.update(planDayMoves).set({ toDate: move.toDate, movedAt: now }).where(eq(planDayMoves.id, latest.id));
  });
}

/** The athlete's moves since `since`, newest first, under each session's current name. */
async function listRecentMoves(userId: string, since: Date, limit: number): Promise<RecentPlanDayMove[]> {
  return await db
    .select({
      planDayId: planDayMoves.planDayId,
      focus: planDays.focus,
      fromDate: planDayMoves.fromDate,
      toDate: planDayMoves.toDate,
      kind: planDayMoves.kind,
      movedAt: planDayMoves.movedAt,
    })
    .from(planDayMoves)
    .innerJoin(planDays, eq(planDays.id, planDayMoves.planDayId))
    .where(and(eq(planDayMoves.userId, userId), gte(planDayMoves.movedAt, since)))
    .orderBy(desc(planDayMoves.movedAt))
    .limit(limit);
}

/** Drop every move made before `cutoff`. Returns how many went. */
async function deleteMovesBefore(cutoff: Date): Promise<number> {
  const result = await db.delete(planDayMoves).where(lt(planDayMoves.movedAt, cutoff));
  return result.rowCount ?? 0;
}

/**
 * The moves athletes make to their plan days themselves (plan_day_moves). The
 * coach's own proposals are recorded with the proposals, never here. None of
 * it uses the instance, so the methods are module functions bound here, as
 * AthleteFactsStorage binds its own: storage.planDayMoves.X() and its mocks
 * still work.
 */
export class PlanDayMovesStorage {
  readonly record = recordMove;
  readonly listRecent = listRecentMoves;
  readonly deleteBefore = deleteMovesBefore;
}
