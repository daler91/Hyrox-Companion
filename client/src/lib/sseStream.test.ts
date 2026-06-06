import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { consumeSSEStream, type SSEStreamResult } from "./sseStream";

// ---------------------------------------------------------------------------
// Test harness
//
// consumeSSEStream reads from a ReadableStreamDefaultReader and batches flushes
// via requestAnimationFrame. We drive it with a fully synchronous fake reader so
// chunk boundaries are deterministic, and we stub rAF so frame timing is under
// the test's control (no real 16ms scheduling, no flakiness).
// ---------------------------------------------------------------------------

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

let rafCallbacks: FrameRequestCallback[] = [];
let rafCalls = 0;
let cancelCalls = 0;

beforeEach(() => {
  rafCallbacks = [];
  rafCalls = 0;
  cancelCalls = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback): number => {
    rafCalls += 1;
    rafCallbacks.push(cb);
    return rafCalls;
  });
  vi.stubGlobal("cancelAnimationFrame", (): void => {
    cancelCalls += 1;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Invoke and drain every animation-frame callback queued so far. */
function runFrames(): void {
  const pending = rafCallbacks;
  rafCallbacks = [];
  for (const cb of pending) cb(0);
}

interface FakeReader {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  read: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
}

/** A reader that yields the given byte chunks in order, then reports done. */
function makeReader(chunks: Uint8Array[]): FakeReader {
  let index = 0;
  const read = vi.fn(async () => {
    if (index >= chunks.length) return { done: true, value: undefined };
    const value = chunks[index];
    index += 1;
    return { done: false, value };
  });
  const cancel = vi.fn(async () => {});
  const reader = { read, cancel } as unknown as ReadableStreamDefaultReader<Uint8Array>;
  return { reader, read, cancel };
}

function dataEvent(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

describe("consumeSSEStream — happy path", () => {
  it("accumulates text from a single data event and returns it", async () => {
    const onFlush = vi.fn();
    const { reader } = makeReader([enc(dataEvent({ text: "Hello world" }))]);

    const result = await consumeSSEStream(reader, { onFlush });

    expect(result).toEqual<SSEStreamResult>({ content: "Hello world", meta: undefined });
    expect(onFlush).toHaveBeenCalledWith(expect.objectContaining({ content: "Hello world" }));
  });

  it("concatenates text from multiple events inside one chunk", async () => {
    const { reader } = makeReader([
      enc(dataEvent({ text: "Hello " }) + dataEvent({ text: "world" })),
    ]);

    const result = await consumeSSEStream(reader, { onFlush: vi.fn() });

    expect(result.content).toBe("Hello world");
  });

  it("concatenates text across separate chunks", async () => {
    const { reader } = makeReader([
      enc(dataEvent({ text: "foo " })),
      enc(dataEvent({ text: "bar" })),
    ]);

    const result = await consumeSSEStream(reader, { onFlush: vi.fn() });

    expect(result.content).toBe("foo bar");
  });
});

describe("consumeSSEStream — chunk-boundary buffering", () => {
  it("buffers a single event split across two chunks", async () => {
    const { reader } = makeReader([enc('data: {"text":"Hel'), enc('lo"}\n\n')]);

    const result = await consumeSSEStream(reader, { onFlush: vi.fn() });

    expect(result.content).toBe("Hello");
  });

  it("decodes a multibyte UTF-8 character split across a chunk boundary", async () => {
    const full = enc(dataEvent({ text: "café" }));
    // 'é' is two UTF-8 bytes (0xC3 0xA9); split between them to force the
    // TextDecoder's streaming buffer to stitch the character back together.
    const splitAt = enc('data: {"text":"caf').length + 1;
    const { reader } = makeReader([full.slice(0, splitAt), full.slice(splitAt)]);

    const result = await consumeSSEStream(reader, { onFlush: vi.fn() });

    expect(result.content).toBe("café");
  });

  it("processes a trailing event that is not terminated by a blank line", async () => {
    const { reader } = makeReader([enc('data: {"text":"tail"}')]);

    const result = await consumeSSEStream(reader, { onFlush: vi.fn() });

    expect(result.content).toBe("tail");
  });

  it("ignores a trailing buffer that is only whitespace", async () => {
    const { reader } = makeReader([enc(dataEvent({ text: "x" }) + "   ")]);

    const result = await consumeSSEStream(reader, { onFlush: vi.fn() });

    expect(result.content).toBe("x");
  });
});

describe("consumeSSEStream — malformed and non-conforming payloads", () => {
  it.each([
    ["invalid JSON", "data: not-json\n\n"],
    ["a JSON array", "data: [1,2,3]\n\n"],
    ["JSON null", "data: null\n\n"],
    ["a JSON number", "data: 42\n\n"],
    ["a JSON string", 'data: "plain"\n\n'],
    ["an object without text/error/meta", 'data: {"foo":"bar"}\n\n'],
  ])("silently skips %s", async (_label, raw) => {
    const { reader } = makeReader([enc(raw)]);

    const result = await consumeSSEStream(reader, { onFlush: vi.fn() });

    expect(result.content).toBe("");
  });

  it("ignores lines that are not 'data: ' lines", async () => {
    const raw = `event: message\nid: 1\n: keep-alive comment\n${dataEvent({ text: "kept" })}`;
    const { reader } = makeReader([enc(raw)]);

    const result = await consumeSSEStream(reader, { onFlush: vi.fn() });

    expect(result.content).toBe("kept");
  });

  it("requires the exact 'data: ' prefix including the space", async () => {
    const { reader } = makeReader([enc('data:{"text":"nospace"}\n\n')]);

    const result = await consumeSSEStream(reader, { onFlush: vi.fn() });

    expect(result.content).toBe("");
  });

  it("does not append empty-string text but keeps processing later events", async () => {
    const { reader } = makeReader([enc(dataEvent({ text: "" }) + dataEvent({ text: "real" }))]);

    const result = await consumeSSEStream(reader, { onFlush: vi.fn() });

    expect(result.content).toBe("real");
  });
});

describe("consumeSSEStream — metadata", () => {
  it("captures metadata from the data.meta field", async () => {
    const { reader } = makeReader([enc(dataEvent({ text: "x", meta: { k: 1 } }))]);

    const result = await consumeSSEStream(reader, { onFlush: vi.fn() });

    expect(result.meta).toEqual({ k: 1 });
    expect(result.content).toBe("x");
  });

  it("extracts a custom metaKey from the payload", async () => {
    const { reader } = makeReader([enc(dataEvent({ text: "x", ragInfo: { sources: 3 } }))]);

    const result = await consumeSSEStream(reader, { onFlush: vi.fn(), metaKey: "ragInfo" });

    expect(result.meta).toEqual({ sources: 3 });
  });

  it("cannot capture a metaKey when the payload lacks text/error/meta (shape guard)", async () => {
    const { reader } = makeReader([enc(dataEvent({ ragInfo: { sources: 3 } }))]);

    const result = await consumeSSEStream(reader, { onFlush: vi.fn(), metaKey: "ragInfo" });

    expect(result.meta).toBeUndefined();
    expect(result.content).toBe("");
  });

  it("prefers the metaKey value over data.meta when both are present", async () => {
    const { reader } = makeReader([
      enc(dataEvent({ text: "x", ragInfo: "from-key", meta: "from-meta" })),
    ]);

    const result = await consumeSSEStream(reader, { onFlush: vi.fn(), metaKey: "ragInfo" });

    expect(result.meta).toBe("from-key");
  });

  it("falls back to data.meta when the metaKey is absent from a payload", async () => {
    const { reader } = makeReader([enc(dataEvent({ text: "x", meta: "from-meta" }))]);

    const result = await consumeSSEStream(reader, { onFlush: vi.fn(), metaKey: "ragInfo" });

    expect(result.meta).toBe("from-meta");
  });

  it("keeps the most recent metadata when multiple events carry it", async () => {
    const { reader } = makeReader([
      enc(dataEvent({ text: "a", meta: { v: 1 } }) + dataEvent({ text: "b", meta: { v: 2 } })),
    ]);

    const result = await consumeSSEStream(reader, { onFlush: vi.fn() });

    expect(result.meta).toEqual({ v: 2 });
  });
});

describe("consumeSSEStream — server error events", () => {
  it("rejects with the server-provided error message", async () => {
    const { reader } = makeReader([enc(dataEvent({ error: "server boom" }))]);

    await expect(consumeSSEStream(reader, { onFlush: vi.fn() })).rejects.toThrow("server boom");
  });

  it("flushes already-accumulated content before throwing on error", async () => {
    const onFlush = vi.fn();
    const { reader } = makeReader([
      enc(dataEvent({ text: "partial" }) + dataEvent({ error: "boom" })),
    ]);

    await expect(consumeSSEStream(reader, { onFlush })).rejects.toThrow("boom");
    expect(onFlush).toHaveBeenCalledWith(expect.objectContaining({ content: "partial" }));
  });
});

describe("consumeSSEStream — abort handling", () => {
  it("rejects with AbortError and cancels the reader when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const onFlush = vi.fn();
    const { reader, read, cancel } = makeReader([enc(dataEvent({ text: "never" }))]);

    await expect(
      consumeSSEStream(reader, { onFlush, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(read).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(onFlush).not.toHaveBeenCalled();
  });

  it("stops mid-stream, suppresses the trailing flush, and rejects with AbortError", async () => {
    const controller = new AbortController();
    const onFlush = vi.fn();
    const cancel = vi.fn(async () => {});
    let call = 0;
    const read = vi.fn(async () => {
      call += 1;
      if (call === 1) return { done: false, value: enc(dataEvent({ text: "A" })) };
      if (call === 2) {
        controller.abort();
        return { done: false, value: enc(dataEvent({ text: "B" })) };
      }
      return { done: true, value: undefined };
    });
    const reader = { read, cancel } as unknown as ReadableStreamDefaultReader<Uint8Array>;

    await expect(
      consumeSSEStream(reader, { onFlush, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });

    // The loop's top-of-iteration abort check stops it before a third read.
    expect(read).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(1);
    // Trailing flush is suppressed so a stale stream can't overwrite newer state.
    expect(onFlush).not.toHaveBeenCalled();

    // A frame scheduled before the abort may still be dispatched by the event
    // loop; the flush guard must treat it as a no-op once aborted.
    runFrames();
    expect(onFlush).not.toHaveBeenCalled();
  });

  it("swallows a failing reader.cancel() and still rejects with AbortError", async () => {
    const controller = new AbortController();
    controller.abort();
    const cancel = vi.fn(async () => {
      throw new Error("cancel failed");
    });
    const read = vi.fn(async () => ({ done: true, value: undefined }));
    const reader = { read, cancel } as unknown as ReadableStreamDefaultReader<Uint8Array>;

    // The best-effort `.catch` on cancel() must not surface the cancel error
    // (which would also become an unhandled rejection) — the abort wins.
    await expect(
      consumeSSEStream(reader, { onFlush: vi.fn(), signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe("consumeSSEStream — animation-frame batching", () => {
  it("schedules at most one frame across multiple chunks with no intervening flush", async () => {
    const { reader } = makeReader([
      enc(dataEvent({ text: "a" })),
      enc(dataEvent({ text: "b" })),
      enc(dataEvent({ text: "c" })),
    ]);
    const onFlush = vi.fn();

    const result = await consumeSSEStream(reader, { onFlush });

    expect(rafCalls).toBe(1);
    expect(result.content).toBe("abc");
    // Final direct flush in the `finally` block delivers the full snapshot.
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenLastCalledWith(expect.objectContaining({ content: "abc" }));
  });

  it("re-schedules a frame after a mid-stream flush and emits incremental snapshots", async () => {
    const onFlush = vi.fn();
    const cancel = vi.fn(async () => {});
    let call = 0;
    const read = vi.fn(async () => {
      call += 1;
      if (call === 1) return { done: false, value: enc(dataEvent({ text: "A" })) };
      if (call === 2) {
        // Simulate a frame firing between chunks: flushes "A", clears dirty.
        runFrames();
        return { done: false, value: enc(dataEvent({ text: "B" })) };
      }
      return { done: true, value: undefined };
    });
    const reader = { read, cancel } as unknown as ReadableStreamDefaultReader<Uint8Array>;

    const result = await consumeSSEStream(reader, { onFlush });

    expect(result.content).toBe("AB");
    expect(rafCalls).toBe(2);
    expect(onFlush).toHaveBeenNthCalledWith(1, expect.objectContaining({ content: "A" }));
    expect(onFlush).toHaveBeenNthCalledWith(2, expect.objectContaining({ content: "AB" }));
  });

  it("does not double-fire a stale frame callback invoked after completion", async () => {
    const onFlush = vi.fn();
    const { reader } = makeReader([enc(dataEvent({ text: "done" }))]);

    await consumeSSEStream(reader, { onFlush });
    expect(onFlush).toHaveBeenCalledTimes(1);

    // Any frame captured during the stream is now stale; invoking it is a no-op.
    runFrames();
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(cancelCalls).toBeGreaterThanOrEqual(1);
  });
});

describe("consumeSSEStream — empty stream", () => {
  it("flushes once with empty content for an immediately-closed stream", async () => {
    const onFlush = vi.fn();
    const { reader, read } = makeReader([]);

    const result = await consumeSSEStream(reader, { onFlush });

    expect(result).toEqual<SSEStreamResult>({ content: "", meta: undefined });
    expect(read).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith(expect.objectContaining({ content: "" }));
  });
});
