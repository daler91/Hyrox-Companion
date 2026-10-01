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
