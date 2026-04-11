import { ArrowDown, ArrowUp, CalendarCheck } from "lucide-react";
import { useEffect, useState } from "react";

interface TimelineTodayIndicatorProps {
  /**
   * Ref attached to the TimelineDateGroup that represents "today". May be
   * null at mount time (virtualizer hasn't rendered that row yet) or after
   * a filter change that excludes today — the indicator re-attaches when
   * the row (re)appears.
   */
  readonly todayRef: React.RefObject<HTMLDivElement | null>;
  /** Ref to the scrollable container used as the IntersectionObserver root. */
  readonly scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Jump back to today. Fires when the user taps the pill. */
  readonly onScrollToToday: () => void;
  /**
   * Whether today appears anywhere in the currently-rendered timeline
   * groups. When false (e.g. the user filtered to a status that excludes
   * today), the pill stays hidden — otherwise it can leak over from a
   * previous "virtualizer unmounted the today row" state and present a
   * dead jump action.
   */
  readonly todayPresent: boolean;
}

type Position = "above" | "below" | "visible";

/**
 * Floating pill that becomes visible when the user has scrolled away from
 * today in the virtualized timeline. It shows an arrow pointing back to
 * today and acts as a persistent "return to now" anchor. Rendered in the
 * scrollable container ABOVE the virtualized list so it can stick to the
 * top of the viewport regardless of current scroll depth.
 */
export function TimelineTodayIndicator({
  todayRef,
  scrollRef,
  onScrollToToday,
  todayPresent,
}: TimelineTodayIndicatorProps) {
  const [position, setPosition] = useState<Position>("visible");

  useEffect(() => {
    const rootEl = scrollRef.current;
    if (!rootEl) return;

    let intersectionObserver: IntersectionObserver | null = null;

    const computePosition = (entry: IntersectionObserverEntry) => {
      if (entry.isIntersecting) {
        setPosition("visible");
        return;
      }
      const todayRect = entry.boundingClientRect;
      const rootRect = entry.rootBounds ?? rootEl.getBoundingClientRect();
      setPosition(todayRect.top < rootRect.top ? "above" : "below");
    };

    const attachObserver = () => {
      const todayEl = todayRef.current;
      if (!todayEl || intersectionObserver) return;
      intersectionObserver = new IntersectionObserver(
        ([entry]) => entry && computePosition(entry),
        { root: rootEl, threshold: 0 },
      );
      intersectionObserver.observe(todayEl);
    };

    const detachObserver = () => {
      if (!intersectionObserver) return;
      intersectionObserver.disconnect();
      intersectionObserver = null;
      // Deliberately do NOT reset `position` here. When the virtualizer
      // unmounts the today row (user scrolled far away), we want the pill
      // to remain visible pointing in whichever direction the
      // IntersectionObserver last reported. Losing it in that exact
      // scenario would defeat the "return to now" purpose. The pill is
      // naturally hidden if position was "visible" when the row unmounted
      // (i.e., today scrolled off-screen while the page was idle).
    };

    // Attempt initial attach. If the today row is already mounted this
    // covers the common case with no extra work.
    attachObserver();

    // Watch the scrollable subtree for late-mounted rows so we re-attach
    // when the virtualizer renders today after an initial paint, and
    // tear down when a filter removes the today row from the DOM.
    const mutationObserver = new MutationObserver(() => {
      if (todayRef.current && !intersectionObserver) {
        attachObserver();
      } else if (!todayRef.current && intersectionObserver) {
        detachObserver();
      }
    });
    mutationObserver.observe(rootEl, { childList: true, subtree: true });

    return () => {
      mutationObserver.disconnect();
      if (intersectionObserver) {
        intersectionObserver.disconnect();
        intersectionObserver = null;
      }
    };
  }, [todayRef, scrollRef]);

  // If today isn't in the filtered timeline at all, the jump action
  // would land nowhere — hide the pill entirely.
  if (!todayPresent) return null;
  if (position === "visible") return null;

  const Arrow = position === "above" ? ArrowUp : ArrowDown;
  const label = position === "above" ? "Today is above" : "Today is below";

  return (
    <button
      type="button"
      onClick={onScrollToToday}
      data-testid="button-today-indicator"
      aria-label={`${label} — jump to today`}
      className="sticky top-3 z-30 ml-auto flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Arrow className="h-4 w-4" aria-hidden="true" />
      <CalendarCheck className="h-4 w-4" aria-hidden="true" />
      <span>Jump to today</span>
    </button>
  );
}
