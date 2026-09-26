/**
 * Missed-session recovery windows, shared by the planner
 * (server/services/missedRecovery) and the timeline's `recoverable` flag
 * (server/storage/timeline.ts), so the card never asks about a miss the sheet
 * would then refuse to move — and the session-length format both the
 * server's summaries and the recovery sheet print.
 *
 * A leaf module — no imports — so it stays importable from anywhere, the
 * client included, without pulling the drizzle graph into the bundle (see
 * shared/weeklyReview.ts).
 */

/** Days, starting today, a missed session can be moved into. */
export const RECOVERY_WINDOW_DAYS = 7;

/** Missed longer ago than this, the plan has moved on: the session can't move, and the timeline stops asking. */
export const RECOVERABLE_WITHIN_DAYS = 7;

/** A session's length as the recovery copy reads it: "45 min", "1h", "1h 35m". */
export function formatSessionLength(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
