import { apiRequest } from "./queryClient";

interface PendingMutation {
  id: string;
  method: string;
  url: string;
  body: unknown;
  timestamp: number;
  retryCount?: number;
}

const STORAGE_KEY = "hyrox-offline-queue";
const MAX_RETRIES = 5;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getQueue(): PendingMutation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PendingMutation[]) : [];
  } catch {
    // Corrupted localStorage data — return empty queue so it gets overwritten on next save
    return [];
  }
}

function saveQueue(queue: PendingMutation[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

export function enqueueMutation(method: string, url: string, body: unknown): string {
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const queue = getQueue();
  queue.push({ id, method, url, body, timestamp: Date.now(), retryCount: 0 });
  saveQueue(queue);
  return id;
}

export function getPendingCount(): number {
  return getQueue().length;
}

export async function flushQueue(): Promise<{ synced: number; failed: number; dropped: number }> {
  const now = Date.now();
  const queue = getQueue();
  if (queue.length === 0) return { synced: 0, failed: 0, dropped: 0 };

  let synced = 0;
  let failed = 0;
  let dropped = 0;
  const remaining: PendingMutation[] = [];

  for (const mutation of queue) {
    // Drop stale mutations older than MAX_AGE_MS
    if (now - mutation.timestamp > MAX_AGE_MS) {
      dropped++;
      continue;
    }

    // Drop mutations that have exceeded MAX_RETRIES
    const retryCount = mutation.retryCount ?? 0;
    if (retryCount >= MAX_RETRIES) {
      dropped++;
      continue;
    }

    try {
      await apiRequest(mutation.method, mutation.url, mutation.body);
      synced++;
    } catch {
      // Network/server error — increment retry count; mutation will be dropped after MAX_RETRIES
      failed++;
      remaining.push({ ...mutation, retryCount: retryCount + 1 });
    }
  }

  saveQueue(remaining);
  return { synced, failed, dropped };
}

// Auto-flush when coming back online
if (globalThis.window !== undefined) {
  globalThis.addEventListener("online", () => {
    void flushQueue()
      .then(({ synced, dropped }) => {
        if (synced > 0 || dropped > 0) {
          globalThis.dispatchEvent(new CustomEvent("offline-sync-complete", { detail: { synced, dropped } }));
        }
      })
      .catch(() => {
        // Individual mutation failures are already handled inside flushQueue.
        // This catches unexpected errors (e.g. localStorage unavailable).
      });
  });
}
