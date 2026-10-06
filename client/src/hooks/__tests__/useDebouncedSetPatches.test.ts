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

/** Reports the page as hidden or visible, as switching apps or tabs does. */
function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

describe("useDebouncedSetPatches", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
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
    await expect(result.current.flushPendingSetPatches()).resolves.toBe(true);
  });

  // CL39 (CODEBASE_ANALYSIS_2026-10-03): the flush swallowed a rejected PATCH,
  // so "Complete workout" logged the plan day with the pre-edit value.
  it("flushPendingSetPatches resolves false when a PATCH it sent fails, and true when all land", async () => {
    const mutate = vi.fn(({ setId }: { setId: string }) =>
      setId === "set-2" ? Promise.reject(new Error("429: Too many requests")) : Promise.resolve(),
    );
    const { result } = renderHook(() => useDebouncedSetPatches<TestPatch>(mutate, DEBOUNCE_MS));

    act(() => {
      result.current.patchSetDebounced("set-1", { reps: 5 });
      result.current.patchSetDebounced("set-2", { reps: 6 });
    });
    await expect(result.current.flushPendingSetPatches()).resolves.toBe(false);
    expect(mutate).toHaveBeenCalledTimes(2);

    act(() => {
      result.current.patchSetDebounced("set-1", { reps: 7 });
    });
    await expect(result.current.flushPendingSetPatches()).resolves.toBe(true);
  });

  it("flushPendingSetPatches resolves false when a PATCH it waited for fails (CL39)", async () => {
    const patch: { refuse?: (error: Error) => void } = {};
    const mutate = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          patch.refuse = reject;
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
    // The owner change sends the PATCH; the flush finds it in flight.
    rerender({ ownerId: null });

    const flush = result.current.flushPendingSetPatches();
    patch.refuse?.(new Error("409: Conflict"));
    await expect(flush).resolves.toBe(false);
  });

  // CL42 (CODEBASE_ANALYSIS_2026-10-03): the queue only flushed on unmount, so
  // swiping the app away inside the debounce window lost the edit.
  it("sends queued PATCHes the moment the page is hidden", () => {
    const mutate = vi.fn();
    const { result } = renderHook(() => useDebouncedSetPatches<TestPatch>(mutate, DEBOUNCE_MS, "workout-a"));

    act(() => {
      result.current.patchSetDebounced("set-1", { weight: 80 });
    });
    // Still visible: nothing goes early.
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mutate).not.toHaveBeenCalled();

    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({ setId: "set-1", data: { weight: 80 }, ownerId: "workout-a" });

    // Sent once: the debounce timer finds nothing left to send.
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS * 2);
    });
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("sends queued PATCHes on pagehide, and stops listening once unmounted (CL42)", () => {
    const mutate = vi.fn();
    const { result, unmount } = renderHook(() => useDebouncedSetPatches<TestPatch>(mutate, DEBOUNCE_MS));

    act(() => {
      result.current.patchSetDebounced("set-1", { reps: 3 });
    });
    globalThis.dispatchEvent(new Event("pagehide"));
    expect(mutate).toHaveBeenCalledTimes(1);

    unmount();
    // Queued through the stale handle: only a listener left behind would send it.
    result.current.patchSetDebounced("set-2", { reps: 4 });
    globalThis.dispatchEvent(new Event("pagehide"));
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(mutate).toHaveBeenCalledTimes(1);
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
