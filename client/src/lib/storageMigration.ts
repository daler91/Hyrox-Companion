const LEGACY_KEY_MAP: Record<string, string> = {
  "hyrox-offline-queue": "fitai-offline-queue",
  "hyrox-log-workout-draft": "fitai-log-workout-draft",
  "hyrox-log-workout-draft-announced": "fitai-log-workout-draft-announced",
  "hyrox-onboarding-complete": "fitai-onboarding-complete",
  "hyrox-privacy-consent-v1": "fitai-privacy-consent-v1",
};

export function migrateLegacyKeys(storage: Storage = globalThis.localStorage): void {
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
