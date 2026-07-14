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
function isSSERecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Parse SSE `data:` lines and accumulate into `acc`. Throws on server errors. */
function processSSELines<TMeta>(
  lines: string[],
  acc: { content: string; meta?: TMeta; extras: Record<string, unknown> },
  metaKey?: string,
  extraKeys?: string[],
): void {
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    let data: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line.slice(6));
      if (!isSSERecord(parsed)) continue;
      data = parsed;
    } catch {
      continue;
    }
    if (metaKey && metaKey in data) {
      acc.meta = data[metaKey] as TMeta;
    } else if (data.meta) {
      acc.meta = data.meta as TMeta;
    }
    if (extraKeys) {
      for (const key of extraKeys) {
        if (key in data) {
          acc.extras[key] = data[key];
        }
      }
    }
    if (typeof data.text === "string" && data.text) {
      acc.content += data.text;
    }
    if (typeof data.error === "string" && data.error) {
      throw new Error(data.error);
    }
  }
}

export interface SSEStreamResult<TMeta = unknown> {
  content: string;
  meta?: TMeta;
  /** Values captured for `extraKeys`, keyed by payload key (last one wins). */
  extras: Record<string, unknown>;
}

export interface SSEStreamOptions<TMeta = unknown> {
  /** Called on each batched flush with accumulated content so far. */
  onFlush: (snapshot: SSEStreamResult<TMeta>) => void;
  /** Optional key name in the SSE payload to extract as metadata (e.g. "ragInfo"). */
  metaKey?: string;
  /**
   * Additional payload keys to capture into `extras` (e.g. "planProposal").
   * Unlike `metaKey`, several keys can be collected in one stream.
   */
  extraKeys?: string[];
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
  const acc = {
    content: "",
    meta: undefined as TMeta | undefined,
    extras: {} as Record<string, unknown>,
  };
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
    options.onFlush({ content: acc.content, meta: acc.meta, extras: acc.extras });
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
        processSSELines(event.split("\n"), acc, options.metaKey, options.extraKeys);
      }
      scheduleFlush();
    }

    if (!aborted && buffer.trim()) {
      processSSELines(buffer.split("\n"), acc, options.metaKey, options.extraKeys);
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

  return { content: acc.content, meta: acc.meta, extras: acc.extras };
}
