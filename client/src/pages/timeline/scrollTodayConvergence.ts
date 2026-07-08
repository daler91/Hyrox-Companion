/**
 * Frame-by-frame convergence loop that lands the timeline's "today" row in
 * the center of the scroll container after the initial data load.
 *
 * A one-shot scroll (smooth or instant) races the virtualizer: rows mount
 * with estimated heights and re-measure over the next several frames, and
 * late-resolving header content (e.g. the summary card) shifts everything
 * below it. Instead of scrolling once and hoping, this loop re-asserts an
 * instant scroll every animation frame until the row's position has been
 * stable and on-target for a few consecutive frames, so measurement and
 * layout churn are absorbed rather than raced.
 *
 * Any scroll intent from the user (wheel, touch, scroll keys) aborts the
 * loop immediately — it must never fight the user for the scrollbar.
 */

export type ScrollTodaySettleReason = "settled" | "timeout" | "user-scroll";

export interface ScrollTodayConvergenceOptions {
  /** The scrollable timeline container. */
  scrollEl: HTMLElement;
  /** Resolves the today row's DOM node; null while the virtualizer hasn't mounted it. */
  getTargetEl: () => HTMLElement | null;
  /** Re-asserts the virtualizer scroll when the target row unmounts mid-flight. */
  remountTarget?: () => void;
  /** Give up after this long (ms). */
  deadlineMs?: number;
  /** Consecutive in-tolerance frames required before settling. */
  stableFrames?: number;
  /** How close (px) the row's center must be to the container's center. */
  tolerancePx?: number;
  /**
   * Called exactly once when the loop finishes on its own. `didScroll`
   * reports whether any scroll was actually applied — a "timeout" with
   * `didScroll === false` means the target never mounted at all.
   */
  onSettle?: (reason: ScrollTodaySettleReason, didScroll: boolean) => void;
}

const USER_SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);

/** Padding from the container top when a row is too tall to center. */
const TALL_ROW_TOP_PADDING_PX = 8;

/**
 * Starts the convergence loop. Returns a cancel function that stops it
 * silently — no `onSettle` call — for use in effect cleanup, where a
 * re-render restarts the loop rather than abandoning it.
 */
export function startScrollTodayConvergence({
  scrollEl,
  getTargetEl,
  remountTarget,
  deadlineMs = 1200,
  stableFrames = 2,
  tolerancePx = 4,
  onSettle,
}: ScrollTodayConvergenceOptions): () => void {
  let finished = false;
  let rafId: number | undefined;
  let stableCount = 0;
  let didScroll = false;
  const start = performance.now();

  const detachListeners = () => {
    scrollEl.removeEventListener("wheel", handleUserScroll);
    scrollEl.removeEventListener("touchstart", handleUserScroll);
    window.removeEventListener("keydown", handleKeydown);
  };

  const stop = () => {
    finished = true;
    detachListeners();
    if (rafId !== undefined) cancelAnimationFrame(rafId);
  };

  const finish = (reason: ScrollTodaySettleReason) => {
    if (finished) return;
    stop();
    onSettle?.(reason, didScroll);
  };

  function handleUserScroll() {
    finish("user-scroll");
  }

  function handleKeydown(event: KeyboardEvent) {
    if (USER_SCROLL_KEYS.has(event.key)) finish("user-scroll");
  }

  scrollEl.addEventListener("wheel", handleUserScroll, { passive: true });
  scrollEl.addEventListener("touchstart", handleUserScroll, { passive: true });
  window.addEventListener("keydown", handleKeydown);

  const frame = () => {
    if (finished) return;
    if (performance.now() - start > deadlineMs) {
      finish(didScroll ? "settled" : "timeout");
      return;
    }

    const el = getTargetEl();
    if (!el) {
      remountTarget?.();
      rafId = requestAnimationFrame(frame);
      return;
    }

    const elRect = el.getBoundingClientRect();
    const scRect = scrollEl.getBoundingClientRect();
    // A row taller than the viewport can't be centered; pin its top just
    // below the container top instead so the day header is what lands.
    const delta =
      elRect.height >= scRect.height
        ? elRect.top - (scRect.top + TALL_ROW_TOP_PADDING_PX)
        : elRect.top + elRect.height / 2 - (scRect.top + scRect.height / 2);

    if (Math.abs(delta) <= tolerancePx) {
      stableCount += 1;
      if (stableCount >= stableFrames) {
        finish("settled");
        return;
      }
    } else {
      stableCount = 0;
      scrollEl.scrollTop += delta;
      didScroll = true;
    }
    rafId = requestAnimationFrame(frame);
  };

  rafId = requestAnimationFrame(frame);

  return stop;
}
