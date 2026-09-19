import { clearOfflineQueue } from "@/lib/offlineQueue";

const LOCAL_STORAGE_EXACT_KEYS = [
  "fitai-offline-queue",
  "fitai-log-workout-draft",
  "fitai-log-workout-draft-announced",
  "fitai-onboarding-complete",
  "fitai-settings-style-audit",
  "hyrox-offline-queue",
  "hyrox-log-workout-draft",
  "hyrox-log-workout-draft-announced",
  "hyrox-onboarding-complete",
  "hyrox-settings-style-audit",
] as const;

const LOCAL_STORAGE_PREFIXES = [
  "fitai-log-workout-draft:",
  "hyrox-log-workout-draft:",
  // Per-user analytics/AI snapshots (see lib/analyticsSnapshot.ts). These hold
  // AI-written coaching narratives, race predictions and MAF heart-rate test
  // data, so they must not outlive the session on a shared device — they were
  // previously left behind by sign-out AND by account deletion.
  "fitai-coach-insights-cache:",
  "fitai-race-prediction-cache:",
  "fitai-overview-analysis-cache:",
  "fitai-maf-tests-cache:",
  "fitai-weekly-review-prompt-dismissed:",
] as const;

/**
 * Workbox caches API responses at runtime (`api-cache`, see the VitePWA config
 * in vite.config.ts). Entries are keyed by URL only, with no per-user
 * partition, so anything left behind is readable by the next person to use the
 * device — and would be served to them by the NetworkFirst handler while the
 * network is slow or offline. Cache Storage is not covered by the
 * localStorage/sessionStorage sweep above, so purge it explicitly.
 */
const RUNTIME_CACHES_TO_PURGE = ["api-cache"] as const;

async function clearApiResponseCache(): Promise<void> {
  try {
    const cacheStorage = globalThis.caches;
    if (!cacheStorage) return;
    await Promise.all(RUNTIME_CACHES_TO_PURGE.map((name) => cacheStorage.delete(name)));
  } catch {
    // Cache Storage is unavailable in private browsing, on insecure origins and
    // in some test environments. Never let that break sign-out.
  }
}

const SESSION_STORAGE_EXACT_KEYS = [
  "fitai-log-workout-draft-announced",
  "hyrox-log-workout-draft-announced",
] as const;

const SESSION_STORAGE_PREFIXES = [
  "fitai-log-workout-draft-announced:",
  "hyrox-log-workout-draft-announced:",
] as const;

/**
 * Wipe everything this device holds for the signed-in athlete.
 *
 * Storage is cleared synchronously so callers that navigate immediately still
 * get the effect; the returned promise settles once the asynchronous Cache
 * Storage purge is done, and callers that can await it should.
 */
export function clearUserLocalData(): Promise<void> {
  clearOfflineQueue();
  removeStorageEntries(getStorage("localStorage"), LOCAL_STORAGE_EXACT_KEYS, LOCAL_STORAGE_PREFIXES);
  removeStorageEntries(getStorage("sessionStorage"), SESSION_STORAGE_EXACT_KEYS, SESSION_STORAGE_PREFIXES);
  return clearApiResponseCache();
}

function getStorage(kind: "localStorage" | "sessionStorage"): Storage | undefined {
  try {
    return globalThis[kind];
  } catch {
    return undefined;
  }
}

function removeStorageEntries(
  storage: Storage | undefined,
  exactKeys: readonly string[],
  prefixes: readonly string[],
): void {
  if (!storage) return;

  try {
    for (const key of exactKeys) {
      storage.removeItem(key);
    }

    const matchingKeys: string[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key && prefixes.some((prefix) => key.startsWith(prefix))) {
        matchingKeys.push(key);
      }
    }

    for (const key of matchingKeys) {
      storage.removeItem(key);
    }
  } catch {
    // Storage may be unavailable in private browsing or hardened contexts.
  }
}
