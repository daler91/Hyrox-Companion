import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDebouncedCallback } from "../useDebouncedCallback";

const DEBOUNCE_MS = 300;

describe("useDebouncedCallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
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
});
