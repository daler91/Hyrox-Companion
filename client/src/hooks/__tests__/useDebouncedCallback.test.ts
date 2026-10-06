import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDebouncedCallback } from "../useDebouncedCallback";

const DEBOUNCE_MS = 300;

/** Reports the page as hidden or visible, as switching apps or tabs does. */
function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

describe("useDebouncedCallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("delays the callback by the specified delayMs", () => {
    const callback = vi.fn();
    const { result } = renderHook(() =>
      useDebouncedCallback(callback, DEBOUNCE_MS),
    );

    act(() => {
      result.current("test-arg");
    });

    expect(callback).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    });
    expect(callback).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("test-arg");
  });

  it("debounces multiple calls and only fires the last one", () => {
    const callback = vi.fn();
    const { result } = renderHook(() =>
      useDebouncedCallback(callback, DEBOUNCE_MS),
    );

    act(() => {
      result.current("call-1");
    });

    act(() => {
      vi.advanceTimersByTime(100);
      result.current("call-2");
    });

    act(() => {
      vi.advanceTimersByTime(200);
      result.current("call-3");
    });

    expect(callback).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("call-3");
  });

  it("flushes pending call on unmount", () => {
    const callback = vi.fn();
    const { result, unmount } = renderHook(() =>
      useDebouncedCallback(callback, DEBOUNCE_MS),
    );

    act(() => {
      result.current("pending-arg");
    });

    expect(callback).not.toHaveBeenCalled();

    unmount();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("pending-arg");
  });

  it("does not flush on unmount if no pending call", () => {
    const callback = vi.fn();
    const { unmount } = renderHook(() =>
      useDebouncedCallback(callback, DEBOUNCE_MS),
    );

    unmount();
    expect(callback).not.toHaveBeenCalled();
  });

  it("uses the latest callback function", () => {
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    let currentCallback = callback1;

    const { result, rerender } = renderHook(() =>
      useDebouncedCallback(currentCallback, DEBOUNCE_MS),
    );

    act(() => {
      result.current("test-arg");
    });

    currentCallback = callback2;
    rerender();

    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(callback1).not.toHaveBeenCalled();
    expect(callback2).toHaveBeenCalledTimes(1);
    expect(callback2).toHaveBeenCalledWith("test-arg");
  });

  it("does not flush on unmount if pending call was already executed", () => {
    const callback = vi.fn();
    const { result, unmount } = renderHook(() =>
      useDebouncedCallback(callback, DEBOUNCE_MS),
    );

    act(() => {
      result.current("arg");
    });

    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(callback).toHaveBeenCalledTimes(1);

    // Now unmount, it should not call it again because timerRef should be null and pendingArgs cleared
    unmount();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  // CL42 (CODEBASE_ANALYSIS_2026-10-03): notes, prescriptions and the fuelling
  // panel only saved on their timer or on unmount, so swiping the app away
  // inside the debounce window lost the edit.
  it("sends the pending call the moment the page is hidden, once", () => {
    const callback = vi.fn();
    const { result } = renderHook(() =>
      useDebouncedCallback(callback, DEBOUNCE_MS),
    );

    act(() => {
      result.current("typed-note");
    });
    // Still visible: nothing goes early.
    document.dispatchEvent(new Event("visibilitychange"));
    expect(callback).not.toHaveBeenCalled();

    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("typed-note");

    // Sent once: the timer finds nothing left to send.
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS * 2);
    });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("does nothing on a hidden page with no pending call (CL42)", () => {
    const callback = vi.fn();
    renderHook(() => useDebouncedCallback(callback, DEBOUNCE_MS));

    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    globalThis.dispatchEvent(new Event("pagehide"));

    expect(callback).not.toHaveBeenCalled();
  });

  it("sends the pending call on pagehide, and stops listening once unmounted (CL42)", () => {
    const callback = vi.fn();
    const { result, unmount } = renderHook(() =>
      useDebouncedCallback(callback, DEBOUNCE_MS),
    );

    act(() => {
      result.current("prescription");
    });
    globalThis.dispatchEvent(new Event("pagehide"));
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith("prescription");

    unmount();
    // Queued through the stale handle: only a listener left behind would send it.
    result.current("after-unmount");
    globalThis.dispatchEvent(new Event("pagehide"));
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
