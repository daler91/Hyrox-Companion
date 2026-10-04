import { clearOfflineQueue } from "@/lib/offlineQueue";
import { apiRequest } from "@/lib/queryClient";
import { timeoutSignal } from "@/lib/timeoutSignal";

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

/**
 * Detach this browser's push subscription from the athlete. A PushManager
 * subscription belongs to the browser, not to whoever is signed in, and
 * survives sign-out: the server kept sending the previous athlete's session
 * briefs and reminders to a shared device, and the next person's Settings
 * showed push as already on. The server row goes first, while the session is
 * still valid (sign-out awaits this before Clerk's signOut), then the browser
 * subscription itself, which kills the endpoint even when that request fails
 * (after account deletion it always does, and the cascade already removed
 * the row). Best effort and bounded: sign-out must never hang on it.
 * P3 (CODEBASE_ANALYSIS_2026-10-03)
 */
async function unsubscribeBrowserPush(): Promise<void> {
  try {
    // getRegistration, not `ready`: `ready` never settles when no service
    // worker is registered.
    const registration = await globalThis.navigator?.serviceWorker?.getRegistration();
    const subscription = await registration?.pushManager?.getSubscription();
    if (!subscription) return;
    try {
      await apiRequest(
        "DELETE",
        "/api/v1/push/unsubscribe",
        { endpoint: subscription.endpoint },
        timeoutSignal(5_000),
      );
    } catch {
      // Unsubscribing below still makes the stored endpoint undeliverable; the
      // server prunes it on the push service's next 404/410.
    }
    await subscription.unsubscribe();
  } catch {
    // Push or service workers unavailable (private browsing, insecure origin,
    // tests). Nothing is subscribed there to clean up.
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
 * Storage purge and the push unsubscribe are done, and callers that can await
 * it should.
 */
export function clearUserLocalData(): Promise<void> {
  clearOfflineQueue();
  removeStorageEntries(getStorage("localStorage"), LOCAL_STORAGE_EXACT_KEYS, LOCAL_STORAGE_PREFIXES);
  removeStorageEntries(getStorage("sessionStorage"), SESSION_STORAGE_EXACT_KEYS, SESSION_STORAGE_PREFIXES);
  return Promise.all([clearApiResponseCache(), unsubscribeBrowserPush()]).then(() => undefined);
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
