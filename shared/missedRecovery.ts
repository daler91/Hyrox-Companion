/**
 * Missed-session recovery windows, shared by the planner (server) and the
 * timeline card (client) so the card never offers a fold the sheet would then
 * refuse.
 *
 * A leaf module — no imports — so the client can use it without pulling the
 * drizzle graph into the bundle (see shared/weeklyReview.ts).
 */

/** Days, starting today, a missed session can be moved into. */
export const RECOVERY_WINDOW_DAYS = 7;

/** Missed longer ago than this, the plan has moved on and only letting it go is offered. */
export const RECOVERABLE_WITHIN_DAYS = 7;
