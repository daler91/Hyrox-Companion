import { useCallback, useEffect, useRef } from "react";

import { useFlushOnPageHide } from "@/hooks/useFlushOnPageHide";

/**
 * Trailing-edge debounce. Returns a stable function that delays calls to
 * `fn` by `delayMs`; each new call cancels the pending one. Flushes the
 * queued call when the component unmounts so inline-edit saves don't get
 * silently dropped if the user closes the dialog mid-edit.
 *
 * It also flushes when the page is hidden or put away: a phone discards a
 * backgrounded page without unmounting it, so a note, prescription or
 * fuelling edit typed just before swiping the app away never saved. CL42
 * (CODEBASE_ANALYSIS_2026-10-03)
 *
 * Deliberately minimal — the codebase already uses plain setTimeout + refs
 * elsewhere (see useOnboarding), so this is the same pattern in reusable
 * form rather than pulling in lodash.debounce.
 */
export function useDebouncedCallback<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  delayMs: number,
): (...args: TArgs) => void {
  const fnRef = useRef(fn);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingArgsRef = useRef<TArgs | null>(null);

  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  // Runs the queued call now, if there is one, and cancels its timer.
  const flushNow = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    const queued = pendingArgsRef.current;
    pendingArgsRef.current = null;
    if (queued) fnRef.current(...queued);
  }, []);

  useEffect(() => {
    return () => {
      // Flush so the user's last edit persists even if they close the
      // dialog before the debounce window expires.
      flushNow();
    };
  }, [flushNow]);

  useFlushOnPageHide(flushNow);

  return useCallback(
    (...args: TArgs) => {
      pendingArgsRef.current = args;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flushNow, delayMs);
    },
    [delayMs, flushNow],
  );
}
