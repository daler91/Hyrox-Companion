import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDebouncedSetPatches } from "../useDebouncedSetPatches";

interface TestPatch {
  weight?: number;
  reps?: number;
}

const DEBOUNCE_MS = 50;

/** Lets every already-settled promise chain run; timers are fake here. */
function drainMicrotasks(): Promise<void> {
  let drained = Promise.resolve();
  for (let tick = 0; tick < 10; tick += 1) drained = drained.then(() => undefined);
  return drained;
}

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

  it("flushes a queued PATCH to the owner it was made under the moment the owner changes", () => {
    // Codex flagged that queued timers fired against the NEW owner's mutate
    // binding, so owner switches cancelled them instead — which silently
    // dropped the last edit whenever the planned-session sheet closed (its
    // owner goes to null), however it was closed (CL18,
    // CODEBASE_ANALYSIS_2026-10-03). Each patch now names its own owner.
    const mutate = vi.fn();
    const initialProps: { ownerId: string | null } = { ownerId: "plan-day-a" };
    const { result, rerender } = renderHook(
      ({ ownerId }) => useDebouncedSetPatches<TestPatch>(mutate, DEBOUNCE_MS, ownerId),
      { initialProps },
    );

    act(() => {
      result.current.patchSetDebounced("set-1", { weight: 60 });
    });
    expect(mutate).not.toHaveBeenCalled();

    rerender({ ownerId: null });

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({ setId: "set-1", data: { weight: 60 }, ownerId: "plan-day-a" });

    // Sent once: the flush emptied the queue, so the timer has nothing left.
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS * 2);
    });
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("tags each patch with the owner current when it was made", () => {
    const mutate = vi.fn();
    const initialProps: { ownerId: string | null } = { ownerId: "workout-a" };
    const { result, rerender } = renderHook(
      ({ ownerId }) => useDebouncedSetPatches<TestPatch>(mutate, DEBOUNCE_MS, ownerId),
      { initialProps },
    );
    rerender({ ownerId: "workout-b" });

    act(() => {
      result.current.patchSetDebounced("set-9", { reps: 4 });
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(mutate).toHaveBeenCalledWith({ setId: "set-9", data: { reps: 4 }, ownerId: "workout-b" });
  });

  it("flushPendingSetPatches also waits for a PATCH the owner change already sent (CL15)", async () => {
    // Closing the sheet sends the queued PATCH without waiting for it. A block
    // save that flushed then found nothing queued and went out beside the row
    // PATCH, so it could land first and miss the row it should have moved.
    let land: () => void = () => undefined;
    const mutate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          land = resolve;
        }),
    );
    const initialProps: { ownerId: string | null } = { ownerId: "plan-day-a" };
    const { result, rerender } = renderHook(
      ({ ownerId }) => useDebouncedSetPatches<TestPatch>(mutate, DEBOUNCE_MS, ownerId),
      { initialProps },
    );
    act(() => {
      result.current.patchSetDebounced("set-1", { reps: 5 });
    });
    rerender({ ownerId: null });
    expect(mutate).toHaveBeenCalledTimes(1);

    let flushed = false;
    const flush = result.current.flushPendingSetPatches().then(() => {
      flushed = true;
    });
    await drainMicrotasks();
    expect(flushed).toBe(false);

    land();
    await flush;
    expect(flushed).toBe(true);
    // Waited for, not sent again.
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("flushPendingSetPatches waits for a PATCH the unmount sent, and not for one that settled", async () => {
    let land: () => void = () => undefined;
    const mutate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          land = resolve;
        }),
    );
    const { result, unmount } = renderHook(() => useDebouncedSetPatches<TestPatch>(mutate, DEBOUNCE_MS));
    act(() => {
      result.current.patchSetDebounced("set-1", { reps: 5 });
    });
    unmount();

    let flushed = false;
    const flush = result.current.flushPendingSetPatches().then(() => {
      flushed = true;
    });
    await drainMicrotasks();
    expect(flushed).toBe(false);
    land();
    await flush;

    // Settled PATCHes are forgotten: the next flush has nothing to wait for.
    await expect(result.current.flushPendingSetPatches()).resolves.toBeUndefined();
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
