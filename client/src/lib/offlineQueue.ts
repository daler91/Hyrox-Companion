import { apiRequest } from "./queryClient";

interface PendingMutation {
  id: string;
  method: string;
  url: string;
  body: unknown;
  timestamp: number;
}

const STORAGE_KEY = "hyrox-offline-queue";

function getQueue(): PendingMutation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: PendingMutation[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

export function enqueueMutation(method: string, url: string, body: unknown): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const queue = getQueue();
  queue.push({ id, method, url, body, timestamp: Date.now() });
  saveQueue(queue);
  return id;
}

export function getPendingCount(): number {
  return getQueue().length;
}

export async function flushQueue(): Promise<{ synced: number; failed: number }> {
  const queue = getQueue();
  if (queue.length === 0) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;
  const remaining: PendingMutation[] = [];

  for (const mutation of queue) {
    try {
      await apiRequest(mutation.method, mutation.url, mutation.body);
      synced++;
    } catch {
      failed++;
      remaining.push(mutation);
    }
  }

  saveQueue(remaining);
  return { synced, failed };
}

// Auto-flush when coming back online
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    flushQueue().then(({ synced }) => {
      if (synced > 0) {
        // Trigger a re-fetch of queries after syncing
        window.dispatchEvent(new CustomEvent("offline-sync-complete", { detail: { synced } }));
      }
    });
  });
}
