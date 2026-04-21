import { useEffect, useRef } from "react";

interface PendingSetPatch<TPatch> {
  timer: ReturnType<typeof setTimeout>;
  patch: TPatch;
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
 */
export function useDebouncedSetPatches<TPatch extends object>(
  mutate: (args: { setId: string; data: TPatch }) => void,
  debounceMs: number,
) {
  const pendingRef = useRef<Map<string, PendingSetPatch<TPatch>>>(new Map());
  const fireRef = useRef<(setId: string) => void>(() => {});

  // Keep `fireRef` bound to the latest `mutate` from an effect rather
  // than assigning to `.current` during render (which trips
  // react-hooks/refs). react-query's mutate is stable, so this effect
  // runs once on mount in practice.
  useEffect(() => {
    fireRef.current = (setId) => {
      const entry = pendingRef.current.get(setId);
      if (!entry) return;
      clearTimeout(entry.timer);
      pendingRef.current.delete(setId);
      mutate({ setId, data: entry.patch });
    };
  }, [mutate]);

  const patchSetDebounced = (setId: string, patch: TPatch) => {
    const existing = pendingRef.current.get(setId);
    if (existing) clearTimeout(existing.timer);
    const merged: TPatch = existing
      ? { ...existing.patch, ...patch }
      : patch;
    const timer = setTimeout(() => fireRef.current(setId), debounceMs);
    pendingRef.current.set(setId, { timer, patch: merged });
  };

  const flushPendingSetPatches = () => {
    const ids = Array.from(pendingRef.current.keys());
    for (const setId of ids) fireRef.current(setId);
  };

  useEffect(() => {
    const pending = pendingRef.current;
    const fire = fireRef;
    return () => {
      const ids = Array.from(pending.keys());
      for (const setId of ids) fire.current(setId);
    };
  }, []);

  return { patchSetDebounced, flushPendingSetPatches };
}
