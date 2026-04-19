import { useCallback, useEffect, useRef } from "react";

/**
 * Trailing-edge debounce. Returns a stable function that delays calls to
 * `fn` by `delayMs`; each new call cancels the pending one. Flushes the
 * queued call when the component unmounts so inline-edit saves don't get
 * silently dropped if the user closes the dialog mid-edit.
 *
 * Deliberately minimal — the codebase already uses plain setTimeout + refs
 * elsewhere (see useOnboarding, useTimelineData), so this is the same
 * pattern in reusable form rather than pulling in lodash.debounce.
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

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        if (pendingArgsRef.current) {
          // Flush so the user's last edit persists even if they close the
          // dialog before the debounce window expires.
          fnRef.current(...pendingArgsRef.current);
        }
      }
    };
  }, []);

  return useCallback(
    (...args: TArgs) => {
      pendingArgsRef.current = args;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const queued = pendingArgsRef.current;
        pendingArgsRef.current = null;
        if (queued) fnRef.current(...queued);
      }, delayMs);
    },
    [delayMs],
  );
}
