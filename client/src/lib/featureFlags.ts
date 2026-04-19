/**
 * Lightweight feature-flag layer used to gate unreleased UI behind a
 * per-browser toggle. The canonical `DEFAULT_FEATURE_FLAGS` below ships to
 * every user; individuals (dogfooders, QA) can override a flag locally by
 * writing to `localStorage.featureFlags` as a JSON object, e.g.
 *
 *   localStorage.setItem("featureFlags", JSON.stringify({ workoutDetailV2: true }))
 *
 * The override is read once on load and memoised — reload the tab to apply
 * changes. We do not ship this as a real remote-config service yet; when
 * enough flags accumulate we can swap this file for a server-driven source
 * without touching call sites.
 */
export interface FeatureFlags {
  /** Enables the redesigned workout-detail dialog (structured exercise table + right-rail panels). */
  workoutDetailV2: boolean;
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  workoutDetailV2: false,
};

const STORAGE_KEY = "featureFlags";

function readOverrides(): Partial<FeatureFlags> {
  if (typeof globalThis.window === "undefined") return {};
  try {
    const raw = globalThis.window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Partial<FeatureFlags>) : {};
  } catch {
    // localStorage blocked (private mode, etc.) — fall back to defaults.
    return {};
  }
}

// Resolved once per page load. Tests can re-import this module after
// re-seeding localStorage; production toggles require a reload, which is
// fine for a dogfood mechanism.
const resolvedFlags: FeatureFlags = { ...DEFAULT_FEATURE_FLAGS, ...readOverrides() };

export function getFeatureFlags(): FeatureFlags {
  return resolvedFlags;
}

export function useFeatureFlag<K extends keyof FeatureFlags>(key: K): FeatureFlags[K] {
  return resolvedFlags[key];
}
