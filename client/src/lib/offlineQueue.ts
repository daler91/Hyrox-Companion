import { inSequence } from "@shared/inSequence";
import { z } from "zod";

import { apiRequest } from "./queryClient";

export interface PendingMutation {
  id: string;
  method: string;
  url: string;
  body: unknown;
  timestamp: number;
  retryCount?: number;
  /** Replays answered with a plain 500, counted apart from retryCount. */
  serverErrorCount?: number;
}

export interface SyncedRequest {
  url: string;
  method: string;
}

export interface DroppedMutationInfo {
  id: string;
  method: string;
  url: string;
  retryCount: number;
  reason: "max_retries" | "max_age" | "queue_overflow" | "storage_full" | "wrong_account";
  ageMs: number;
}

export type OnMutationDroppedCallback = (info: DroppedMutationInfo) => void;

const droppedCallbacks: OnMutationDroppedCallback[] = [];
export const OFFLINE_QUEUE_CHANGE_EVENT = "offline-queue-change";
export const OFFLINE_SYNC_COMPLETE_EVENT = "offline-sync-complete";

interface EnqueueMutationOptions {
  id?: string;
}

export interface OfflineQueueChangeDetail {
  pendingCount: number;
}

export interface OfflineSyncCompleteDetail {
  synced: number;
  failed: number;
  dropped: number;
  /** The url/method of each successfully replayed mutation, so listeners can
   * invalidate the query caches that write actually touched. */
  syncedRequests: SyncedRequest[];
}

/**
 * Register a callback that fires whenever a mutation is permanently dropped
 * from the offline queue. Returns an unsubscribe function.
 */
export function onMutationDropped(cb: OnMutationDroppedCallback): () => void {
  droppedCallbacks.push(cb);
  return () => {
    const idx = droppedCallbacks.indexOf(cb);
    if (idx >= 0) droppedCallbacks.splice(idx, 1);
  };
}

function notifyDropped(info: DroppedMutationInfo) {
  for (const cb of droppedCallbacks) {
    try {
      cb(info);
    } catch {
      // Never let a callback error break the queue
    }
  }
}

function dispatchWindowEvent<T>(name: string, detail: T) {
  if (globalThis.window === undefined) return;
  globalThis.dispatchEvent(new CustomEvent(name, { detail }));
}

function notifyQueueChanged() {
  dispatchWindowEvent<OfflineQueueChangeDetail>(OFFLINE_QUEUE_CHANGE_EVENT, {
    pendingCount: getPendingCount(),
  });
}

function notifySyncComplete(detail: OfflineSyncCompleteDetail) {
  dispatchWindowEvent<OfflineSyncCompleteDetail>(OFFLINE_SYNC_COMPLETE_EVENT, detail);
}

const pendingMutationSchema: z.ZodType<PendingMutation> = z.object({
  id: z.string(),
  method: z.string(),
  url: z.string(),
  body: z.unknown(),
  timestamp: z.number(),
  retryCount: z.number().optional(),
  serverErrorCount: z.number().optional(),
});
const pendingMutationArraySchema = z.array(pendingMutationSchema);

const STORAGE_KEY = "fitai-offline-queue";
// Tracks which signed-in user last owned the queue, so a shared/kiosk device
// can't replay one athlete's queued writes into a different athlete's account
// (the queue itself carries no per-mutation owner — see reconcileQueueOwner).
const OWNER_KEY = "fitai-offline-queue-owner";
const MAX_RETRIES = 5;
// A 500 can be a passing fault (a DB blip) or one this exact write hits every
// time. It doesn't spend MAX_RETRIES, but since the flush stops at a failed
// entry, an endless 500 would hold every write queued behind it for MAX_AGE_MS;
// this many (about an hour of backed-off retries) bounds that. 502/503/504
// (a deploy, an overloaded proxy) never count.
const MAX_SERVER_ERROR_RETRIES = 20;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_QUEUE_SIZE = 100;
// Retry delay while writes are pending and the browser reports online: 5s,
// doubling with each replay that stopped on a failure, up to 5 minutes.
const RETRY_BASE_DELAY_MS = 5_000;
const RETRY_MAX_DELAY_MS = 5 * 60 * 1000;

// The user reconcileQueueOwner last confirmed in this page. Automatic retries
// wait for it, so they never replay a queue that a previous athlete left on the
// device before the signed-in athlete's reconcile has had the chance to drop it.
let reconciledOwner: string | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
// Replays in a row that stopped on a failed entry; sets the retry backoff.
let failedRuns = 0;
// Bumped whenever the stored queue is thrown away (sign-out, or another
// athlete's queue dropped), so a replay that was in flight at that moment
// doesn't write its leftovers back into the next athlete's queue.
let queueGeneration = 0;

function browserReportsOffline(): boolean {
  return globalThis.navigator?.onLine === false;
}

/**
 * Retry the queue later while it holds writes and the browser reports online
 * (CL27, CODEBASE_ANALYSIS_2026-10-03). The `online` event only covers a device
 * that actually went offline: a write queued after a timeout, or one a failed
 * replay left behind, used to wait for a reload. One timer at a time; its delay
 * doubles with each failed replay, up to RETRY_MAX_DELAY_MS.
 */
function scheduleQueueRetry(): void {
  if (retryTimer !== null) return;
  const delayMs = Math.min(RETRY_BASE_DELAY_MS * 2 ** failedRuns, RETRY_MAX_DELAY_MS);
  retryTimer = setTimeout(() => { // DevSkim: ignore DS172411
    retryTimer = null;
    retryPendingWrites();
  }, delayMs);
}

function resetRetryBackoff(): void {
  failedRuns = 0;
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

/** Flush if there is a write to send, a reconciled owner to send it as, and a network. */
function retryPendingWrites(): void {
  if (reconciledOwner === null || browserReportsOffline() || getPendingCount() === 0) return;
  void flushQueue().catch(() => {
    // Individual mutation failures are already handled inside flushQueue.
  });
}

function getQueue(): PendingMutation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = pendingMutationArraySchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    // Corrupted localStorage data — return empty queue so it gets overwritten on next save
    return [];
  }
}

function saveQueue(queue: PendingMutation[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // QuotaExceededError — evict oldest half and retry once.
    //
    // Every eviction here is permanent loss of work the athlete believes is
    // saved, so it has to be announced. The overflow path in enqueueMutation
    // notifies for exactly this reason; this path used to drop the same rows
    // in silence, and it drops OLDEST first — the sessions least likely to
    // still be in the athlete's head.
    const evictionPoint = Math.floor(queue.length / 2);
    const trimmed = queue.slice(evictionPoint);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      notifyDroppedAll(queue.slice(0, evictionPoint));
    } catch {
      // Still failing — clear the queue entirely to recover
      localStorage.removeItem(STORAGE_KEY);
      notifyDroppedAll(queue);
    }
  }
  notifyQueueChanged();
}

/** Announce every entry in `evicted` as permanently dropped, for the given reason. */
function notifyDroppedAll(evicted: PendingMutation[], reason: DroppedMutationInfo["reason"] = "storage_full") {
  const now = Date.now();
  for (const mutation of evicted) {
    notifyDropped({
      id: mutation.id,
      method: mutation.method,
      url: mutation.url,
      retryCount: mutation.retryCount ?? 0,
      reason,
      ageMs: now - mutation.timestamp,
    });
  }
}

export function createOfflineMutationId(): string {
  const crypto = globalThis.crypto;

  if (!crypto) {
    throw new TypeError("Secure random values are unavailable for offline mutation IDs.");
  }

  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  if (typeof crypto.getRandomValues !== "function") {
    throw new TypeError("Secure random values are unavailable for offline mutation IDs.");
  }

  const values = new Uint8Array(16);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function enqueueMutation(method: string, url: string, body: unknown, options?: EnqueueMutationOptions): string {
  const id = options?.id ?? createOfflineMutationId();
  const queue = getQueue();

  // Evict oldest entries when queue is at capacity
  while (queue.length >= MAX_QUEUE_SIZE) {
    const evicted = queue.shift();
    if (evicted) {
      notifyDropped({
        id: evicted.id,
        method: evicted.method,
        url: evicted.url,
        retryCount: evicted.retryCount ?? 0,
        reason: "queue_overflow",
        ageMs: Date.now() - evicted.timestamp,
      });
    }
  }

  queue.push({ id, method, url, body, timestamp: Date.now(), retryCount: 0 });
  saveQueue(queue);
  // Queued while the browser still reports online (a request that timed out on
  // slow wifi, say): no `online` event will come to replay it (CL27).
  if (!browserReportsOffline()) scheduleQueueRetry();
  return id;
}

export function getPendingCount(): number {
  return getQueue().length;
}

/**
 * Read-only snapshot of the queued mutations. Used by the timeline's
 * pending-entry overlay to render queued-but-unsynced writes.
 */
export function getPendingMutations(): readonly PendingMutation[] {
  return getQueue();
}

export function clearOfflineQueue(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(OWNER_KEY);
  } catch {
    // ignore
  }
  reconciledOwner = null;
  queueGeneration++;
  resetRetryBackoff();
  notifyQueueChanged();
}

/**
 * Reconcile the queue's stamped owner against the currently signed-in user
 * before ever flushing. `localStorage` is per-browser, not per-session: if a
 * device is shared and a prior athlete's session ended without an explicit
 * sign-out (closed tab, expired session), their queued mutations would
 * otherwise sit in `fitai-offline-queue` and get silently replayed —
 * authenticated as whoever signs in next — the moment the app mounts. Any
 * mismatch drops the stale queue instead of risking a cross-account write.
 */
export function reconcileQueueOwner(currentUserId: string | null | undefined): void {
  if (currentUserId == null) return;
  try {
    const storedOwner = localStorage.getItem(OWNER_KEY);
    if (storedOwner && storedOwner !== currentUserId) {
      const queue = getQueue();
      if (queue.length > 0) {
        notifyDroppedAll(queue, "wrong_account");
        localStorage.removeItem(STORAGE_KEY);
        queueGeneration++;
        // The previous athlete's backoff mustn't delay this athlete's retries.
        resetRetryBackoff();
        notifyQueueChanged();
      }
    }
    localStorage.setItem(OWNER_KEY, currentUserId);
    reconciledOwner = currentUserId;
  } catch {
    // Storage unavailable — best-effort only.
  }
}

/**
 * The signed-in user is gone or changing: hold automatic retries until the
 * next reconcileQueueOwner, so a sign-in without a reload can't have the retry
 * timer replay the previous athlete's queue under the new session (CL27).
 */
export function releaseQueueOwner(): void {
  reconciledOwner = null;
}

// Rejections that mean "not yet" rather than "never": the idempotency
// middleware's answer while the original, timed-out request is still running,
// and a CSRF token that went stale.
const RETRYABLE_REJECTION_CODES = new Set(["IDEMPOTENT_REQUEST_IN_PROGRESS", "EBADCSRFTOKEN"]);

/**
 * Whether the server answered a replay with a client error that retrying won't
 * change. Only these spend the retry budget (CL28, CODEBASE_ANALYSIS_2026-10-03):
 * no response at all, a 401 from a session that lapsed while offline, a 408,
 * a 429 or a 5xx says nothing about the write, and counting them dropped
 * queued workouts on a flaky connection. MAX_AGE_MS still bounds those.
 */
function isDefinitiveRejection(error: unknown): boolean {
  const status = responseStatus(error);
  if (status === null || status < 400 || status >= 500 || status === 401 || status === 408 || status === 429) {
    return false;
  }
  const { message } = error as Error;
  return !RETRYABLE_REJECTION_CODES.has(rejectionCode(message.slice(message.indexOf(":") + 1)));
}

/**
 * The HTTP status of a failed replay, or null when there was no response.
 * apiRequest throws `${status}: ${body}` for a non-ok response. A TypeError, a
 * timeout, RateLimitError or a failed CSRF token fetch has no such prefix.
 * String ops, not a regex, as in humanizeApiError.
 */
function responseStatus(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const { message } = error;
  const colonIdx = message.indexOf(":");
  const head = colonIdx >= 0 ? message.slice(0, colonIdx) : "";
  if (head.length !== 3 || ![...head].every((c) => c >= "0" && c <= "9")) return null;
  return Number(head);
}

/** The entry after a failed replay: which failure budget it spends, if any. */
function afterFailedReplay(mutation: PendingMutation, error: unknown): PendingMutation {
  if (isDefinitiveRejection(error)) return { ...mutation, retryCount: (mutation.retryCount ?? 0) + 1 };
  if (responseStatus(error) === 500) {
    return { ...mutation, serverErrorCount: (mutation.serverErrorCount ?? 0) + 1 };
  }
  return mutation;
}

function rejectionCode(body: string): string {
  try {
    const parsed = JSON.parse(body) as { code?: unknown } | null;
    return typeof parsed?.code === "string" ? parsed.code : "";
  } catch {
    return "";
  }
}

let flushInFlight: Promise<{ synced: number; failed: number; dropped: number }> | null = null;
let flushRequestedDuringRun = false;

/**
 * Flush the offline queue, coalescing concurrent callers (W12) while still
 * draining mutations enqueued mid-flush (P2). `doFlushQueue` snapshots the queue
 * at its start, so it can't replay anything queued after — those entries are
 * preserved (not overwritten) by its merge, and if a caller triggered a flush
 * during the run we schedule one follow-up drain so they are sent promptly
 * rather than waiting for the next `online` event. Sharing the in-flight run
 * also avoids two overlapping flushes racing on saveQueue during flapping.
 */
export function flushQueue(): Promise<{ synced: number; failed: number; dropped: number }> {
  if (flushInFlight) {
    flushRequestedDuringRun = true;
    return flushInFlight;
  }
  flushRequestedDuringRun = false;
  flushInFlight = doFlushQueue().finally(() => {
    flushInFlight = null;
    // A caller triggered a flush mid-run (its mutations weren't in this run's
    // snapshot). They're preserved in the queue; drain once more to send them,
    // unless the run stopped on a failed entry: they wait behind it, and its
    // backed-off retry is already scheduled.
    if (flushRequestedDuringRun && failedRuns === 0 && getPendingCount() > 0) {
      flushRequestedDuringRun = false;
      void flushQueue();
    }
  });
  return flushInFlight;
}

async function doFlushQueue(): Promise<{ synced: number; failed: number; dropped: number }> {
  const now = Date.now();
  const generation = queueGeneration;
  const queue = getQueue();
  if (queue.length === 0) return { synced: 0, failed: 0, dropped: 0 };

  let synced = 0;
  let failed = 0;
  let dropped = 0;
  const syncedRequests: SyncedRequest[] = [];
  const remaining: PendingMutation[] = [];

  // One at a time, in the order they were queued: two edits to the same
  // record must land in the order they were made. So the run stops at the
  // first entry that fails; sending the ones behind it would let a newer edit
  // land first and the older one overwrite it on a later run (CL29,
  // CODEBASE_ANALYSIS_2026-10-03). They stay queued, in order, for the retry.
  let halted = false;
  await inSequence(queue, async (mutation) => {
    const retryCount = mutation.retryCount ?? 0;
    const ageMs = now - mutation.timestamp;

    // Drop stale mutations older than MAX_AGE_MS
    if (ageMs > MAX_AGE_MS) {
      dropped++;
      notifyDropped({ id: mutation.id, method: mutation.method, url: mutation.url, retryCount, reason: "max_age", ageMs });
      return;
    }

    // Drop mutations that have exceeded MAX_RETRIES
    if (retryCount >= MAX_RETRIES || (mutation.serverErrorCount ?? 0) >= MAX_SERVER_ERROR_RETRIES) {
      dropped++;
      notifyDropped({ id: mutation.id, method: mutation.method, url: mutation.url, retryCount, reason: "max_retries", ageMs });
      return;
    }

    if (halted) {
      remaining.push(mutation);
      return;
    }

    try {
      await apiRequest(mutation.method, mutation.url, mutation.body, undefined, {
        "X-Idempotency-Key": mutation.id,
      });
      synced++;
      syncedRequests.push({ url: mutation.url, method: mutation.method });
    } catch (error) {
      // Only a definitive rejection counts toward MAX_RETRIES (CL28), and a
      // plain 500 toward MAX_SERVER_ERROR_RETRIES, so neither can hold the queue
      // forever; any other failure keeps its counts.
      failed++;
      halted = true;
      remaining.push(afterFailedReplay(mutation, error));
    }
  });

  // The queue was cleared (sign-out) or handed to another athlete while this
  // run was replaying: what it holds is no longer this queue's to write back.
  if (generation !== queueGeneration) return { synced, failed, dropped };

  // Preserve mutations enqueued during this flush: they weren't in our snapshot
  // so they weren't replayed, and writing back only `remaining` would drop
  // them. Merge the failed retries with any entries that appeared since (P2).
  const processedIds = new Set(queue.map((m) => m.id));
  const enqueuedDuringFlush = getQueue().filter((m) => !processedIds.has(m.id));
  saveQueue([...remaining, ...enqueuedDuringFlush]);
  if (failed > 0) {
    failedRuns++;
    scheduleQueueRetry();
  } else {
    resetRetryBackoff();
    // A write queued mid-run may have found the old timer and not set its own.
    if (enqueuedDuringFlush.length > 0) scheduleQueueRetry();
  }
  if (synced > 0 || dropped > 0) {
    notifySyncComplete({ synced, failed, dropped, syncedRequests });
  }
  return { synced, failed, dropped };
}

// Auto-flush when coming back online
if (globalThis.window !== undefined) {
  globalThis.addEventListener("online", () => {
    // A new connection: replay now, and start any backoff again from the base.
    resetRetryBackoff();
    void flushQueue()
      .catch(() => {
        // Individual mutation failures are already handled inside flushQueue.
        // This catches unexpected errors (e.g. localStorage unavailable).
      });
  });
  // A device that never lost its network gets no `online` event, so returning
  // to the app is the other moment to retry a pending write (CL27).
  globalThis.addEventListener("focus", retryPendingWrites);
  globalThis.document?.addEventListener("visibilitychange", () => {
    if (globalThis.document.visibilityState !== "hidden") retryPendingWrites();
  });
}
