/**
 * Coach chat constants shared by the client and the server.
 *
 * A leaf module on purpose, like `shared/weeklyReview.ts`: the chat input
 * counts against this limit, and a value-import from the `@shared/schema`
 * barrel would drag the drizzle graph into the browser bundle — the invariant
 * `script/bundle-check.ts` exists to protect.
 */

/**
 * Longest chat message the coach accepts, enforced by the request schema and
 * the chat input alike. Room for a race recap or a pasted session (AI coach
 * chat review, I20); it was 1,000.
 */
export const CHAT_MESSAGE_MAX_LENGTH = 4000;

/**
 * Largest photo a chat message can carry, as base64 characters (about 3 MB of
 * image). The chat input sends one already shrunk to 1600 px, far under this;
 * the chat routes' body parser allows it plus the message.
 */
export const CHAT_PHOTO_MAX_BASE64_CHARS = 4 * 1024 * 1024;

/** Sent in place of words when the athlete attaches a photo and types nothing. */
export const CHAT_PHOTO_DEFAULT_MESSAGE = "What do you make of this photo?";

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
