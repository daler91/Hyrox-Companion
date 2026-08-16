/**
 * Weekly-review constants shared by the client and the server.
 *
 * A leaf module on purpose. The client renders this limit in the intent
 * textarea's counter, and a value-import from the `@shared/schema` barrel would
 * drag the drizzle graph into the browser bundle — the invariant
 * `script/bundle-check.ts` exists to protect. Types can still come from the
 * barrel, since `import type` erases.
 */

/** Longest intent accepted, enforced by the request schema and the textarea alike. */
export const WEEKLY_REVIEW_INTENT_MAX_LENGTH = 280;
