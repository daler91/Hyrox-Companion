import { ArrowDown, ArrowUp, CalendarCheck } from "lucide-react";
import { useEffect, useState } from "react";

interface TimelineTodayIndicatorProps {
  /**
   * Ref attached to the TimelineDateGroup that represents "today". The
   * indicator uses this to observe whether today is currently in the
   * scrollable viewport; the pill only renders when it isn't.
   */
  readonly todayRef: React.RefObject<HTMLDivElement | null>;
  /** Ref to the scrollable container used as the IntersectionObserver root. */
  readonly scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Jump back to today. Fires when the user taps the pill. */
  readonly onScrollToToday: () => void;
}

type Position = "above" | "below" | "visible";

/**
 * Floating pill that becomes visible when the user has scrolled away from
 * today in the virtualized timeline. It shows an arrow pointing back to
 * today and acts as a persistent "return to now" anchor. Kept out of the
 * virtualizer's row set deliberately — injecting a sticky element into
 * absolutely-positioned rows would fight the layout.
 */
export function TimelineTodayIndicator({
  todayRef,
  scrollRef,
  onScrollToToday,
}: TimelineTodayIndicatorProps) {
  const [position, setPosition] = useState<Position>("visible");

  useEffect(() => {
    const todayEl = todayRef.current;
    const rootEl = scrollRef.current;
    if (!todayEl || !rootEl) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) {
          setPosition("visible");
          return;
        }
        // Determine direction by comparing bounding boxes to the root.
        const todayRect = entry.boundingClientRect;
        const rootRect = entry.rootBounds ?? rootEl.getBoundingClientRect();
        setPosition(todayRect.top < rootRect.top ? "above" : "below");
      },
      {
        root: rootEl,
        threshold: 0,
      },
    );

    observer.observe(todayEl);
    return () => observer.disconnect();
  }, [todayRef, scrollRef]);

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
