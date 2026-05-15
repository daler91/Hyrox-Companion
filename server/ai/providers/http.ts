import { AI_REQUEST_TIMEOUT_MS } from "../../constants";
import { withTimeout } from "../../gemini/client";
import type { ResolvedTextAiRequest, TextAiStreamChunk, TextAiUsage } from "./types";

export interface ParsedSseTextEvent {
  readonly text?: string;
  readonly usage?: TextAiUsage;
  readonly done?: boolean;
}

export async function readJsonPayload(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>;
}

export function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.codePointAt(end - 1) === 47) {
    end--;
  }
  return value.slice(0, end);
}

function parseSseDataBlocks(buffer: string, flush = false): { events: string[]; remainder: string } {
  const blocks = buffer.replaceAll("\r\n", "\n").split("\n\n");
  let remainder = blocks.pop() ?? "";
  if (flush && remainder.trim().length > 0) {
    blocks.push(remainder);
    remainder = "";
  }
  const events = blocks
    .map((block) =>
      block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n"),
    )
    .filter(Boolean);
  return { events, remainder };
}

function* textChunksFromEvents(
  request: ResolvedTextAiRequest,
  events: string[],
  parseEvent: (event: string) => ParsedSseTextEvent,
): Generator<TextAiStreamChunk, boolean> {
  for (const event of events) {
    const chunk = parseEvent(event);
    if (chunk.done) return true;
    if (chunk.text || chunk.usage) {
      yield { text: chunk.text, usage: chunk.usage, model: request.model };
    }
  }
  return false;
}

export async function* streamSseTextChunks(
  request: ResolvedTextAiRequest,
  responsePromise: Promise<Response>,
  parseEvent: (event: string) => ParsedSseTextEvent,
): AsyncGenerator<TextAiStreamChunk> {
  const response = await withTimeout(responsePromise, AI_REQUEST_TIMEOUT_MS, request.label);
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (request.signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) {
        buffer += decoder.decode();
      } else {
        buffer += decoder.decode(value, { stream: true });
      }
      const parsed = parseSseDataBlocks(buffer, done);
      buffer = parsed.remainder;
      const chunks = textChunksFromEvents(request, parsed.events, parseEvent);
      let next = chunks.next();
      while (!next.done) {
        yield next.value;
        next = chunks.next();
      }
      if (next.value) return;
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}
