import { logger } from "../logger";
import { DAY_MS, formatRecentPlanChanges, RECENT_PLAN_CHANGES_DAYS } from "../prompts/recentPlanChanges";
import { storage } from "../storage";

/** The most proposals the record lists: a busy fortnight, still short enough to read. */
const RECENT_PLAN_CHANGES_LIMIT = 8;
/** The most of the athlete's own moves it lists alongside them. */
const RECENT_PLAN_DAY_MOVES_LIMIT = 12;

/**
 * Load and format the athlete's recent plan changes (formatRecentPlanChanges):
 * the coach's applied proposals and the athlete's own moves.
 * Context, not a requirement: a failed read leaves the record out rather than
 * failing the reply.
 */
export async function loadRecentPlanChanges(userId: string, now: Date = new Date()): Promise<string> {
  try {
    const since = new Date(now.getTime() - RECENT_PLAN_CHANGES_DAYS * DAY_MS);
    const [proposals, moves] = await Promise.all([
      storage.planProposals.getRecentlyApplied(userId, since, RECENT_PLAN_CHANGES_LIMIT),
      storage.planDayMoves.listRecent(userId, since, RECENT_PLAN_DAY_MOVES_LIMIT),
    ]);
    if (proposals.length === 0 && moves.length === 0) return "";
    // "today" and "yesterday" are the athlete's, so the record needs their zone.
    const user = await storage.users.getUser(userId);
    return formatRecentPlanChanges({ proposals, moves }, now, user?.userTimezone);
  } catch (error) {
    // The read error only; no plan content.
    // bearer:disable javascript_lang_logger_leak
    logger.warn({ err: error }, "[recent-plan-changes] Read failed; the coach goes without the record");
    return "";
  }
}
