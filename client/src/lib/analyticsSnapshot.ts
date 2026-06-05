import { useEffect } from "react";

import { safeLocalStorage } from "./safeStorage";

/**
 * Instant-paint snapshots for the analytics tabs. We persist the last fetched
 * result to localStorage and feed it back as React Query `placeholderData`, so
 * a tab renders the previous result immediately on open (no spinner/blank)
 * while the live query revalidates in the background. Snapshot keys are scoped
 * by userId by the caller so a previous account's data is never shown.
 */
export function readAnalyticsSnapshot<T>(key: string): T | undefined {
  const raw = safeLocalStorage.getItem(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Corrupt/legacy payload — ignore and let the live query repopulate it.
    return undefined;
  }
}

export function writeAnalyticsSnapshot(key: string, value: unknown): void {
  try {
    safeLocalStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Best-effort: quota or serialization failures must never break the tab.
  }
}

/**
 * Persist `data` to the snapshot whenever it changes and is real (not the
 * placeholder we just read back). No-ops when `key` is null (e.g. signed out).
 */
export function useWriteAnalyticsSnapshot(
  key: string | null,
  data: unknown,
  isPlaceholderData: boolean,
): void {
  useEffect(() => {
    if (!key || isPlaceholderData || data === undefined) return;
    writeAnalyticsSnapshot(key, data);
  }, [key, data, isPlaceholderData]);
}
