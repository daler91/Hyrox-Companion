import { logger } from "../logger";
import { DAY_MS, formatRecentPlanChanges, RECENT_PLAN_CHANGES_DAYS } from "../prompts/recentPlanChanges";
import { storage } from "../storage";

/** The most proposals the record lists: a busy fortnight, still short enough to read. */
const RECENT_PLAN_CHANGES_LIMIT = 8;

/**
 * Load and format the athlete's recent plan changes (formatRecentPlanChanges).
 * Context, not a requirement: a failed read leaves the record out rather than
 * failing the reply.
 */
export async function loadRecentPlanChanges(userId: string, now: Date = new Date()): Promise<string> {
  try {
    const since = new Date(now.getTime() - RECENT_PLAN_CHANGES_DAYS * DAY_MS);
    const proposals = await storage.planProposals.getRecentlyApplied(userId, since, RECENT_PLAN_CHANGES_LIMIT);
    if (proposals.length === 0) return "";
    // "today" and "yesterday" are the athlete's, so the record needs their zone.
    const user = await storage.users.getUser(userId);
    return formatRecentPlanChanges(proposals, now, user?.userTimezone);
  } catch (error) {
    // The read error only; no plan content.
    // bearer:disable javascript_lang_logger_leak
    logger.warn({ err: error }, "[recent-plan-changes] Read failed; the coach goes without the record");
    return "";
  }
}
