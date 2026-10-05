import { lazy, type LazyExoticComponent } from "react";

import { setStorageItem, tryGetStorageItem } from "@/lib/safeStorage";

/**
 * Recovery for a route chunk that no longer exists. After a deploy, a tab
 * still running the previous build asks for `/assets/<old-hash>.js`; the
 * server answers 404 (C38) and the import rejects with "Failed to fetch
 * dynamically imported module", which CHUNK_ERROR_MESSAGE matches. React
 * caches a rejected lazy import, so the error boundary's "Try again"
 * re-threw the same error until the athlete reloaded by hand. First-session
 * tabs, hard reloads and mixed-replica rollouts all hit it, because the
 * service worker covers none of them. CL3 (CODEBASE_ANALYSIS_2026-10-03)
 */

const CHUNK_RELOAD_AT_KEY = "fitai-chunk-reload-at";
/**
 * One automatic reload per window. A chunk that still fails after the reload
 * is an outage, not a stale tab, so the error boundary takes over rather than
 * the page reloading in a loop.
 */
const CHUNK_RELOAD_WINDOW_MS = 60_000;

// Browser wording for a dynamic import that could not be fetched or
// evaluated (Chromium, Firefox, Safari) and Vite's preload failure, for lazy
// imports not wrapped below.
const CHUNK_ERROR_MESSAGE =
  /dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

export class ChunkLoadError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "ChunkLoadError";
  }
}

/** Whether `error` is a code chunk that failed to load, which only a reload fixes. */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "ChunkLoadError" || CHUNK_ERROR_MESSAGE.test(error.message);
}

export function reloadPage(): void {
  globalThis.location.reload();
}

/**
 * Reloads the page unless it already did so within the window, or cannot
 * remember that it did (storage blocked), or the device is offline, where a
 * reload would only swap the app for the browser's offline page.
 */
function reloadOnceForStaleChunk(): boolean {
  if (!globalThis.navigator.onLine) return false;
  const last = tryGetStorageItem("sessionStorage", CHUNK_RELOAD_AT_KEY);
  if (!last.ok) return false;
  const now = Date.now();
  if (last.value !== null && now - Number(last.value) < CHUNK_RELOAD_WINDOW_MS) return false;
  setStorageItem("sessionStorage", CHUNK_RELOAD_AT_KEY, String(now));
  if (tryGetStorageItem("sessionStorage", CHUNK_RELOAD_AT_KEY).value !== String(now)) return false;
  reloadPage();
  return true;
}

function neverSettle(): undefined {
  return undefined;
}

/** Never settles: Suspense keeps its fallback up until the reload lands. */
function waitForReload(): Promise<never> {
  return new Promise<never>(neverSettle);
}

/**
 * The component type `React.lazy` accepts, read from its own signature so the
 * bound is React's (`ComponentType<any>`) without an explicit `any`.
 */
type LazyComponent = Awaited<ReturnType<Parameters<typeof lazy>[0]>>["default"];

/**
 * `React.lazy` for a route: a chunk that fails to load reloads the page once
 * to pick up the current build; if that is not possible, it rejects with a
 * ChunkLoadError so the error boundary's "Try again" can reload instead.
 * Any rejected import is treated this way, not only a missing chunk: React
 * cannot retry a page whose module threw while loading either, and the
 * window bounds that case to one reload before the boundary shows it.
 * Generic over the component, as `React.lazy` is, so it keeps the props: a
 * lazy tab that takes them (the Analytics range-scoped tabs) goes through it
 * too. CL3 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function lazyWithReload<T extends LazyComponent>(
  load: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() =>
    load().catch((error: unknown) => {
      if (reloadOnceForStaleChunk()) return waitForReload();
      throw new ChunkLoadError(error);
    }),
  );
}
