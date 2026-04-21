import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDebouncedSetPatches } from "../useDebouncedSetPatches";

interface TestPatch {
  weight?: number;
  reps?: number;
}

const DEBOUNCE_MS = 50;

describe("useDebouncedSetPatches", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires a single merged PATCH after the debounce window", () => {
    const mutate = vi.fn();
    const { result } = renderHook(() =>
      useDebouncedSetPatches<TestPatch>(mutate, DEBOUNCE_MS),
    );

    act(() => {
      result.current.patchSetDebounced("set-1", { weight: 60 });
      result.current.patchSetDebounced("set-1", { reps: 8 });
    });

    expect(mutate).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({
      setId: "set-1",
      data: { weight: 60, reps: 8 },
    });
  });

  it("flushPendingSetPatches commits every queued PATCH synchronously", () => {
    const mutate = vi.fn();
    const { result } = renderHook(() =>
      useDebouncedSetPatches<TestPatch>(mutate, DEBOUNCE_MS),
    );

    act(() => {
      result.current.patchSetDebounced("set-1", { weight: 60 });
      result.current.patchSetDebounced("set-2", { reps: 5 });
      result.current.flushPendingSetPatches();
    });

    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate).toHaveBeenCalledWith({ setId: "set-1", data: { weight: 60 } });
    expect(mutate).toHaveBeenCalledWith({ setId: "set-2", data: { reps: 5 } });

    // No further PATCH after the window expires — the flush emptied the queue.
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(mutate).toHaveBeenCalledTimes(2);
  });

  it("cancelPending drops queued PATCHes so they never fire", () => {
    // Codex flagged that when the owning entity (plan day / workout)
    // changes, queued timers survive and fire against the new owner's
    // mutate binding — corrupting data. The consumer hooks now call
    // cancelPending() in their owner-switch sentinel; this guards that
    // cancellation contract.
    const mutate = vi.fn();
    const { result } = renderHook(() =>
      useDebouncedSetPatches<TestPatch>(mutate, DEBOUNCE_MS),
    );

    act(() => {
      result.current.patchSetDebounced("set-1", { weight: 60 });
      result.current.cancelPending();
    });

    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS * 2);
    });

    expect(mutate).not.toHaveBeenCalled();
  });

  it("flushes pending PATCHes on unmount so dialog-close mid-edit doesn't drop the last keystroke", () => {
    const mutate = vi.fn();
    const { result, unmount } = renderHook(() =>
      useDebouncedSetPatches<TestPatch>(mutate, DEBOUNCE_MS),
    );

    act(() => {
      result.current.patchSetDebounced("set-1", { weight: 75 });
    });
    expect(mutate).not.toHaveBeenCalled();

    unmount();

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({ setId: "set-1", data: { weight: 75 } });
  });
});
