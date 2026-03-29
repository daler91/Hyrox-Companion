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
    return raw ? (JSON.parse(raw) as PendingMutation[]) : [];
  } catch (err: unknown) {
    console.warn("Failed to parse offline queue from localStorage", err);
    return [];
  }
}

function saveQueue(queue: PendingMutation[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

export function enqueueMutation(method: string, url: string, body: unknown): string {
  const id = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
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
    } catch (err: unknown) {
      console.warn("Offline mutation failed, will retry on next flush", err);
      failed++;
      remaining.push(mutation);
    }
  }

  saveQueue(remaining);
  return { synced, failed };
}

// Auto-flush when coming back online
if (typeof globalThis.window !== "undefined") {
  globalThis.addEventListener("online", () => {
    flushQueue().then(({ synced }) => {
      if (synced > 0) {
        globalThis.dispatchEvent(new CustomEvent("offline-sync-complete", { detail: { synced } }));
      }
    });
  });
}
