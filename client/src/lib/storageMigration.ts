const LEGACY_KEY_MAP: Record<string, string> = {
  "hyrox-offline-queue": "fitai-offline-queue",
  "hyrox-log-workout-draft": "fitai-log-workout-draft",
  "hyrox-log-workout-draft-announced": "fitai-log-workout-draft-announced",
  "hyrox-onboarding-complete": "fitai-onboarding-complete",
  "hyrox-privacy-consent-v1": "fitai-privacy-consent-v1",
};

/**
 * The page's localStorage, or null where reading it throws: with site data
 * blocked the getter itself throws a SecurityError. Read in a default
 * parameter, outside any try, that threw at module load and left a blank page
 * instead of the landing page. CL60 (CODEBASE_ANALYSIS_2026-10-03)
 */
function pageLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function migrateLegacyKeys(storage: Storage | null | undefined = pageLocalStorage()): void {
  if (!storage) return;
  for (const [oldKey, newKey] of Object.entries(LEGACY_KEY_MAP)) {
    try {
      const oldValue = storage.getItem(oldKey);
      if (oldValue === null) continue;
      if (storage.getItem(newKey) === null) {
        storage.setItem(newKey, oldValue);
      }
      storage.removeItem(oldKey);
    } catch {
      // Storage quota / disabled — fail silently; the app falls back to defaults.
    }
  }
}
