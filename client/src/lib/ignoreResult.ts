/**
 * For a promise whose failure is already handled, or deliberately dropped:
 * it settles to nothing, and the promise doesn't float unhandled.
 *
 * Perf: this lives in its own dependency-free module, not in
 * `hooks/chat/chatSessionModel.ts`, because eager modules in the entry chunk
 * (`lib/workoutInvalidation.ts` via `offlineInvalidation`) use it. Importing it
 * from the chat model pulled the chat model, `sseStream`, `chatErrors`,
 * `chatMessage`, `describeAiError` and the shared enums into every page load
 * (~7.2 kB raw / ~3.5 kB gzip across 4 chunks on the critical path).
 */
export const ignoreResult = (): undefined => undefined;
