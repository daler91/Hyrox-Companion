/**
 * Missed-session recovery windows, shared by the planner
 * (server/services/missedRecovery) and the timeline's `recoverable` flag
 * (server/storage/timeline.ts), so the card never asks about a miss the sheet
 * would then refuse to move.
 *
 * A leaf module — no imports — so it stays importable from anywhere, the
 * client included, without pulling the drizzle graph into the bundle (see
 * shared/weeklyReview.ts).
 */

/** Days, starting today, a missed session can be moved into. */
export const RECOVERY_WINDOW_DAYS = 7;

/** Missed longer ago than this, the plan has moved on: the session can't move, and the timeline stops asking. */
export const RECOVERABLE_WITHIN_DAYS = 7;
