import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ScrollTodayConvergenceOptions,
  startScrollTodayConvergence,
} from "../scrollTodayConvergence";

// Manual rAF queue + clock so each frame is driven explicitly, independent of
// vitest's fake-timer defaults. flushFrame() advances the clock and runs every
// callback queued at that point (callbacks re-queue themselves for the next
// frame, mirroring the browser).
let rafQueue: Array<{ id: number; cb: FrameRequestCallback }> = [];
let nextRafId = 1;
let now = 0;

function flushFrame(advanceMs = 16) {
  now += advanceMs;
  const queue = rafQueue;
  rafQueue = [];
  for (const { cb } of queue) cb(now);
}

const CONTAINER_HEIGHT = 600;
const TARGET_HEIGHT = 300;
/** The target row's offset from the top of the scroll content. */
const TARGET_CONTENT_OFFSET = 2000;
/** scrollTop that puts the target's center on the container's center. */
const CENTERED_SCROLL_TOP = TARGET_CONTENT_OFFSET - (CONTAINER_HEIGHT - TARGET_HEIGHT) / 2;

function fakeRect(top: number, height: number): DOMRect {
  return { top, height } as unknown as DOMRect;
}

/**
 * A scroll container and a target whose on-screen rect is derived from the
 * container's scrollTop, so scrollTop writes actually move the target —
 * letting the loop converge the way it does against real layout.
 */
function makeScrollFixture(targetHeight = TARGET_HEIGHT) {
  const scrollEl = document.createElement("div");
  scrollEl.getBoundingClientRect = () => fakeRect(0, CONTAINER_HEIGHT);
  scrollEl.scrollTop = 0;

  const targetEl = document.createElement("div");
  targetEl.getBoundingClientRect = () =>
    fakeRect(TARGET_CONTENT_OFFSET - scrollEl.scrollTop, targetHeight);

  return { scrollEl, targetEl };
}

function start(overrides: Partial<ScrollTodayConvergenceOptions> = {}) {
  const { scrollEl, targetEl } = makeScrollFixture();
  const onSettle = vi.fn();
  const cancel = startScrollTodayConvergence({
    scrollEl,
    getTargetEl: () => targetEl,
    onSettle,
    ...overrides,
  });
  return { scrollEl, targetEl, onSettle, cancel };
}

describe("startScrollTodayConvergence", () => {
  beforeEach(() => {
    rafQueue = [];
    nextRafId = 1;
    now = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const id = nextRafId++;
      rafQueue.push({ id, cb });
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      rafQueue = rafQueue.filter((item) => item.id !== id);
    });
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("converges on the target and settles after consecutive stable frames", () => {
    const { scrollEl, onSettle } = start();

    // Frame 1 applies the centering delta; frames 2-3 observe it stable.
    flushFrame();
    expect(scrollEl.scrollTop).toBe(CENTERED_SCROLL_TOP);
    flushFrame();
    expect(onSettle).not.toHaveBeenCalled();
    flushFrame();

    expect(onSettle).toHaveBeenCalledExactlyOnceWith("settled", true);
    expect(rafQueue).toHaveLength(0);
  });

  it("re-centers when layout shifts after the first landing", () => {
    const { scrollEl, targetEl, onSettle } = start();

    flushFrame();
    expect(scrollEl.scrollTop).toBe(CENTERED_SCROLL_TOP);

    // Late-mounting header content pushes the row 100px further down.
    const shift = 100;
    targetEl.getBoundingClientRect = () =>
      fakeRect(TARGET_CONTENT_OFFSET + shift - scrollEl.scrollTop, TARGET_HEIGHT);

    flushFrame();
    expect(scrollEl.scrollTop).toBe(CENTERED_SCROLL_TOP + shift);
    flushFrame();
    flushFrame();
    expect(onSettle).toHaveBeenCalledExactlyOnceWith("settled", true);
  });

  it("waits for the target to mount, re-asserting the virtualizer each frame", () => {
    const { targetEl, scrollEl } = makeScrollFixture();
    const remountTarget = vi.fn();
    const onSettle = vi.fn();
    let mounted = false;
    startScrollTodayConvergence({
      scrollEl,
      getTargetEl: () => (mounted ? targetEl : null),
      remountTarget,
      onSettle,
    });

    flushFrame();
    flushFrame();
    flushFrame();
    expect(remountTarget).toHaveBeenCalledTimes(3);
    expect(scrollEl.scrollTop).toBe(0);

    mounted = true;
    flushFrame(); // applies delta
    flushFrame();
    flushFrame();
    expect(onSettle).toHaveBeenCalledExactlyOnceWith("settled", true);
  });

  it("times out with didScroll=false when the target never mounts", () => {
    const { scrollEl } = makeScrollFixture();
    const onSettle = vi.fn();
    startScrollTodayConvergence({
      scrollEl,
      getTargetEl: () => null,
      deadlineMs: 100,
      onSettle,
    });

    for (let i = 0; i < 10; i++) flushFrame();

    expect(onSettle).toHaveBeenCalledExactlyOnceWith("timeout", false);
    expect(scrollEl.scrollTop).toBe(0);
    expect(rafQueue).toHaveLength(0);
  });

  it("pins tall rows to the container top instead of centering", () => {
    const { scrollEl, targetEl } = makeScrollFixture(CONTAINER_HEIGHT + 200);
    const onSettle = vi.fn();
    startScrollTodayConvergence({ scrollEl, getTargetEl: () => targetEl, onSettle });

    flushFrame();
    // top padding of 8px: elTop = offset - scrollTop = 8
    expect(scrollEl.scrollTop).toBe(TARGET_CONTENT_OFFSET - 8);
  });

  it("aborts immediately on wheel input without further scroll writes", () => {
    const { scrollEl, targetEl, onSettle } = start();

    flushFrame();
    const landedAt = scrollEl.scrollTop;

    scrollEl.dispatchEvent(new Event("wheel"));
    expect(onSettle).toHaveBeenCalledExactlyOnceWith("user-scroll", true);

    // Shift the layout; no further frames may write scrollTop.
    targetEl.getBoundingClientRect = () =>
      fakeRect(TARGET_CONTENT_OFFSET + 500 - scrollEl.scrollTop, TARGET_HEIGHT);
    flushFrame();
    flushFrame();
    expect(scrollEl.scrollTop).toBe(landedAt);
  });

  it("aborts on scroll keys but ignores unrelated keys", () => {
    const { onSettle } = start();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(onSettle).not.toHaveBeenCalled();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(onSettle).toHaveBeenCalledExactlyOnceWith("user-scroll", false);
  });

  it("cancel() stops the loop silently without calling onSettle", () => {
    const { scrollEl, onSettle, cancel } = start();

    cancel();
    flushFrame();
    flushFrame();
    flushFrame();

    expect(onSettle).not.toHaveBeenCalled();
    expect(scrollEl.scrollTop).toBe(0);
    expect(rafQueue).toHaveLength(0);
  });
});
