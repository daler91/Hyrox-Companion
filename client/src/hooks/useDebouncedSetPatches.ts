import { useCallback, useEffect, useRef } from "react";

interface PendingSetPatch<TPatch> {
  timer: ReturnType<typeof setTimeout>;
  patch: TPatch;
  /** The owner the edit was made under, so a flush after an owner change still targets it. */
  ownerId: string | undefined;
}

/**
 * Per-set debounce coordinator. Cell inputs call `patchSetDebounced`
 * on every keystroke; each set id owns one pending entry whose patch
 * fields merge as the user keeps editing inside `debounceMs`. Callers
 * use `flushPendingSetPatches` to commit every pending PATCH
 * synchronously before a downstream action that expects the server
 * state to reflect the latest edits (e.g. a coach-note regenerate).
 *
 * The debounce window matches the pre-refactor `useDebouncedCallback`
 * default cell inputs used, so user-visible fire rate is unchanged.
 * Flushes on unmount so closing the dialog mid-edit doesn't drop the
 * last keystroke — same guarantee `useDebouncedCallback` gave when
 * the debounce lived inside each cell input.
 *
 * It also flushes when `ownerId` changes, and every patch is sent with the
 * owner it was made under. The planned-session sheet stays mounted when it
 * closes — its owner just goes to null — so the unmount flush never ran there,
 * and the owner switch used to CANCEL the queue (firing it would have PATCHed
 * the new owner). Closing the sheet any way but its Done/Log buttons dropped
 * the last edit (CL18, CODEBASE_ANALYSIS_2026-10-03).
 */
export function useDebouncedSetPatches<TPatch extends object>(
  mutate: (args: { setId: string; data: TPatch; ownerId?: string }) => unknown,
  debounceMs: number,
  ownerId?: string | null,
) {
  const pendingRef = useRef<Map<string, PendingSetPatch<TPatch>>>(new Map());
  const fireRef = useRef<(setId: string) => Promise<void>>(() => Promise.resolve());

  // Keep `fireRef` bound to the latest `mutate` from an effect rather
  // than assigning to `.current` during render (which trips
  // react-hooks/refs). react-query's mutate is stable, so this effect
  // runs once on mount in practice.
  useEffect(() => {
    fireRef.current = async (setId) => {
      const entry = pendingRef.current.get(setId);
      if (!entry) return;
      clearTimeout(entry.timer);
      pendingRef.current.delete(setId);
      await Promise.resolve(mutate({ setId, data: entry.patch, ownerId: entry.ownerId })).catch(() => undefined);
    };
  }, [mutate]);

  // Stable identities for the three callbacks. Cell inputs pass these
  // through as `onUpdateSet` — without useCallback, each render of the
  // owning hook returns a new function, which breaks the React.memo
  // guarantees on GroupRow / SetRow / FieldInput and re-renders every
  // cell on every optimistic cache patch (i.e. every 350ms during
  // typing).
  const patchSetDebounced = useCallback((setId: string, patch: TPatch) => {
    const existing = pendingRef.current.get(setId);
    if (existing) clearTimeout(existing.timer);
    const merged: TPatch = existing
      ? { ...existing.patch, ...patch }
      : patch;
    const timer = setTimeout(() => {
      fireRef.current(setId).catch(() => undefined);
    }, debounceMs);
    pendingRef.current.set(setId, { timer, patch: merged, ownerId: ownerId ?? undefined });
  }, [debounceMs, ownerId]);

  const flushPendingSetPatches = useCallback(async () => {
    const ids = Array.from(pendingRef.current.keys());
    await Promise.all(ids.map((setId) => fireRef.current(setId)));
  }, []);

  const getPendingPatches = useCallback(() => {
    return Array.from(pendingRef.current, ([setId, entry]) => ({
      setId,
      patch: entry.patch,
    }));
  }, []);

  // Runs on unmount and whenever the owner changes. Each entry carries its
  // own owner, so the flush PATCHes the owner the edit was made under even
  // though the caller has already moved on.
  useEffect(() => {
    const pending = pendingRef.current;
    const fire = fireRef;
    return () => {
      const ids = Array.from(pending.keys());
      Promise.all(ids.map((setId) => fire.current(setId))).catch(() => undefined);
    };
  }, [ownerId]);

  return {
    patchSetDebounced,
    flushPendingSetPatches,
    getPendingPatches,
  };
}
