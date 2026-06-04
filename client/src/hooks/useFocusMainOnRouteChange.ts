import { useEffect, useRef } from "react";
import { useLocation } from "wouter";

/**
 * Move focus to the main content region on client-side route changes (WCAG
 * 2.4.3 Focus Order). wouter does not manage focus on navigation, so after a
 * sidebar/link navigation a keyboard or screen-reader user would stay focused
 * on the link they just activated rather than landing on the new page.
 *
 * Focusing `#main-content` (which carries `tabIndex={-1}` and
 * `focus:outline-none`) also resets the screen-reader reading cursor to the top
 * of the new view. It is invisible to mouse users. The first render is skipped
 * so initial page load doesn't steal focus from the skip-to-content link.
 */
export function useFocusMainOnRouteChange(): void {
  const [location] = useLocation();
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // preventScroll: the container manages its own scroll position; focusing it
    // must not yank the viewport.
    document.getElementById("main-content")?.focus({ preventScroll: true });
  }, [location]);
}
