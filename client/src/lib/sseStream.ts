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
}

/**
 * Consume an SSE ReadableStream, batching UI updates via rAF.
 * Returns the final accumulated content and metadata.
 */
export async function consumeSSEStream<TMeta = unknown>(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options: SSEStreamOptions<TMeta>,
): Promise<SSEStreamResult<TMeta>> {
  const decoder = new TextDecoder();
  const acc = { content: "", meta: undefined as TMeta | undefined };
  let buffer = "";
  let rafId = 0;
  let dirty = false;

  const flush = () => {
    if (!dirty) return;
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

    if (buffer.trim()) {
      processSSELines(buffer.split("\n"), acc, options.metaKey);
    }
  } finally {
    cancelAnimationFrame(rafId);
    dirty = true;
    flush();
  }

  return { content: acc.content, meta: acc.meta };
}
