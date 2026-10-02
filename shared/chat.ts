/**
 * Coach chat constants shared by the client and the server.
 *
 * A leaf module on purpose, like `shared/weeklyReview.ts`: the chat input
 * counts against this limit, and a value-import from the `@shared/schema`
 * barrel would drag the drizzle graph into the browser bundle — the invariant
 * `script/bundle-check.ts` exists to protect.
 */

/** Longest chat message the coach accepts, enforced by the request schema and the chat input alike. */
export const CHAT_MESSAGE_MAX_LENGTH = 1000;

/**
 * What the coach is doing while its reply is on the way (AI coach chat review,
 * I11). The chat stream sends one as `{ status }` whenever it changes, and the
 * chat names it in place of the bare typing dots.
 */
export const CHAT_STATUS_STEPS = [
  "thinking",
  "drafting_plan",
  "looking_up_workouts",
  "looking_up_exercises",
  "looking_up_records",
  "searching_notes",
] as const;

export type ChatStatusStep = (typeof CHAT_STATUS_STEPS)[number];
