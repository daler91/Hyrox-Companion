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
] as const;

const SESSION_STORAGE_EXACT_KEYS = [
  "fitai-log-workout-draft-announced",
  "hyrox-log-workout-draft-announced",
] as const;

const SESSION_STORAGE_PREFIXES = [
  "fitai-log-workout-draft-announced:",
  "hyrox-log-workout-draft-announced:",
] as const;

export function clearUserLocalData(): void {
  clearOfflineQueue();
  removeStorageEntries(getStorage("localStorage"), LOCAL_STORAGE_EXACT_KEYS, LOCAL_STORAGE_PREFIXES);
  removeStorageEntries(getStorage("sessionStorage"), SESSION_STORAGE_EXACT_KEYS, SESSION_STORAGE_PREFIXES);
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
