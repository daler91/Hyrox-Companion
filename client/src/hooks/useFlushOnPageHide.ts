import { useEffect, useRef } from "react";

/**
 * Calls `flush` the moment the page is hidden or put away: `visibilitychange`
 * to hidden (switching apps, swiping to the app switcher, changing tabs) and
 * `pagehide` (navigating away, closing the tab, entering the back/forward
 * cache). A phone freezes or discards a backgrounded page without React ever
 * unmounting, so a debounced autosave that waits for its timer or for unmount
 * never reaches the server, and an edit typed just before swiping the app away
 * was lost. CL42 (CODEBASE_ANALYSIS_2026-10-03)
 *
 * `flush` should send what is queued without waiting on it: the browser gives
 * a hidden page little time, so the request has to start at once.
 */
export function useFlushOnPageHide(flush: () => void): void {
  const flushRef = useRef(flush);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushRef.current();
    };
    const onPageHide = () => {
      flushRef.current();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    globalThis.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      globalThis.removeEventListener("pagehide", onPageHide);
    };
  }, []);
}
