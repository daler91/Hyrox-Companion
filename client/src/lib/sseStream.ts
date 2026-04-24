/**
 * Reusable SSE (Server-Sent Events) stream parser.
 *
 * Reads an SSE byte stream, parses `data: <json>` lines, and batches
 * updates via `requestAnimationFrame` so consumers flush at most once
 * per frame instead of once per chunk.
 */

/** Shape of a single SSE data payload. */
export interface SSEData<TMeta = unknown> {
  text?: string;
  error?: string;
  meta?: TMeta;
}

/** Type guard for raw parsed JSON. */
function isSSEData(v: unknown): v is SSEData {
  return typeof v === "object" && v !== null && !Array.isArray(v) && ("text" in v || "error" in v || "meta" in v);
}

/** Parse SSE `data:` lines and accumulate into `acc`. Throws on server errors. */
function processSSELines<TMeta>(
  lines: string[],
  acc: { content: string; meta?: TMeta },
  metaKey?: string,
): void {
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    let data: SSEData;
    try {
      const parsed: unknown = JSON.parse(line.slice(6));
      if (!isSSEData(parsed)) continue;
      data = parsed;
    } catch {
      continue;
    }
    if (metaKey && metaKey in (data as Record<string, unknown>)) {
      acc.meta = (data as Record<string, unknown>)[metaKey] as TMeta;
    } else if (data.meta) {
      acc.meta = data.meta as TMeta;
    }
    if (data.text) {
      acc.content += data.text;
    }
    if (data.error) {
      throw new Error(data.error);
    }
  }
}

export interface SSEStreamResult<TMeta = unknown> {
  content: string;
  meta?: TMeta;
}

export interface SSEStreamOptions<TMeta = unknown> {
  /** Called on each batched flush with accumulated content so far. */
  onFlush: (snapshot: SSEStreamResult<TMeta>) => void;
  /** Optional key name in the SSE payload to extract as metadata (e.g. "ragInfo"). */
  metaKey?: string;
  /**
   * Optional abort signal — when aborted, stops reading, cancels the pending
   * rAF, and suppresses the trailing flush so stale callbacks can't overwrite
   * a newer stream's state.
   */
  signal?: AbortSignal;
}

/**
 * Consume an SSE ReadableStream, batching UI updates via rAF.
 * Returns the final accumulated content and metadata.
 *
 * Aborting via `options.signal` cancels the reader, drops the pending rAF
 * flush, and rejects with the abort reason so the caller can distinguish
 * user-cancellation from network errors.
 */
/**
 * Wire an abort signal to a callback that fires once, immediately if the
 * signal is already aborted. Returns a teardown that detaches the listener.
 * Pulled out so consumeSSEStream stays under the cognitive-complexity limit.
 */
function bindAbortSignal(signal: AbortSignal | undefined, onAbort: () => void): () => void {
  if (!signal) return () => {};
  if (signal.aborted) {
    onAbort();
    return () => {};
  }
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

export async function consumeSSEStream<TMeta = unknown>(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options: SSEStreamOptions<TMeta>,
): Promise<SSEStreamResult<TMeta>> {
  const decoder = new TextDecoder();
  const acc = { content: "", meta: undefined as TMeta | undefined };
  let buffer = "";
  let rafId = 0;
  let dirty = false;
  let aborted = false;

  const detachAbort = bindAbortSignal(options.signal, () => {
    aborted = true;
    reader.cancel().catch(() => {/* best effort */});
  });

  const flush = () => {
    if (!dirty || aborted) return;
    dirty = false;
    options.onFlush({ content: acc.content, meta: acc.meta });
  };

  const scheduleFlush = () => {
    if (!dirty) {
      dirty = true;
      rafId = requestAnimationFrame(flush);
    }
  };

  try {
    while (true) {
      if (aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const event of events) {
        processSSELines(event.split("\n"), acc, options.metaKey);
      }
      scheduleFlush();
    }

    if (!aborted && buffer.trim()) {
      processSSELines(buffer.split("\n"), acc, options.metaKey);
    }
  } finally {
    cancelAnimationFrame(rafId);
    if (!aborted) {
      dirty = true;
      flush();
    }
    detachAbort();
  }

  if (aborted) {
    throw new DOMException("Stream aborted", "AbortError");
  }

  return { content: acc.content, meta: acc.meta };
}
