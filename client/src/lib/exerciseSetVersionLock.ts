/**
 * Client half of the exercise_sets optimistic lock (finding D5).
 *
 * The server side has existed since W18: a PATCH may carry `expectedVersion`,
 * the UPDATE is gated on it, every successful PATCH bumps `version` by exactly
 * one, and a mismatch is a 409. Nothing on the client sent the field, so two
 * devices editing one set were last-write-wins, and the unmount flush of a
 * debounced edit could overwrite a row another device had already moved on.
 *
 * Carrying the version correctly needs two things this module provides:
 *   1. the latest version the client has seen for each set, taken from the
 *      cached row and from EVERY PATCH response, including responses the UI's
 *      sequence guard discards;
 *   2. one PATCH in flight per set at a time, so a second edit to the same set
 *      waits for the first response and sends the version it reported instead
 *      of the version the first PATCH is about to bump.
 *
 * After a 409 the set's known version is dropped and any PATCH already queued
 * behind the failed one is rejected without being sent: a stale edit must roll
 * back and show the other device's row, never retry over it.
 */
export interface SetVersionTracker {
  /** Record the cached row's version before an edit. Never lowers a known version. */
  seed(setId: string, version: unknown): void;
  /** Record the version a PATCH response came back with. */
  noteServerVersion(setId: string, version: unknown): void;
  /** The version to send as `expectedVersion`, or undefined when none is known. */
  expectedVersion(setId: string): number | undefined;
  /** Forget the set's version after a 409 and fail any PATCH queued behind it. */
  markConflict(setId: string): void;
  /** Run `task` once every earlier task for the same set has settled. */
  enqueue<T>(setId: string, task: () => Promise<T>): Promise<T>;
  reset(): void;
}

/** Thrown for a queued PATCH dropped because an earlier one on the same set hit a 409. */
export class SetConflictError extends Error {
  constructor(setId: string) {
    super(`Set ${setId} was updated elsewhere; a queued edit was not sent`);
    this.name = "SetConflictError";
  }
}

// apiRequest throws non-ok responses as `${status}: ${body}`.
const CONFLICT_MESSAGE_PREFIX = "409:";

export function isSetConflictError(error: unknown): boolean {
  if (error instanceof SetConflictError) return true;
  return error instanceof Error && error.message.startsWith(CONFLICT_MESSAGE_PREFIX);
}

function asVersion(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : undefined;
}

function noop(): void {
  // Settled chains are only sequencing points; their outcome is reported elsewhere.
}

export function createSetVersionTracker(): SetVersionTracker {
  const versions = new Map<string, number>();
  const conflicted = new Set<string>();
  const chains = new Map<string, Promise<unknown>>();

  return {
    seed(setId, version) {
      // A new edit starts from the cached row, which the conflict refetch replaces.
      conflicted.delete(setId);
      const known = asVersion(version);
      if (known === undefined) return;
      versions.set(setId, Math.max(known, versions.get(setId) ?? 0));
    },
    noteServerVersion(setId, version) {
      const known = asVersion(version);
      if (known !== undefined) versions.set(setId, known);
    },
    expectedVersion(setId) {
      return versions.get(setId);
    },
    markConflict(setId) {
      versions.delete(setId);
      conflicted.add(setId);
    },
    enqueue(setId, task) {
      const previous = chains.get(setId) ?? Promise.resolve();
      const next = previous.catch(noop).then(() => {
        if (conflicted.has(setId)) throw new SetConflictError(setId);
        return task();
      });
      chains.set(setId, next);
      next.catch(noop).finally(() => {
        if (chains.get(setId) === next) chains.delete(setId);
      });
      return next;
    },
    reset() {
      versions.clear();
      conflicted.clear();
      chains.clear();
    },
  };
}
