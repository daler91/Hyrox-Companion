import { AI_REQUEST_TIMEOUT_MS } from "../../constants";
import { withTimeout } from "../retry";
import type { ResolvedTextAiRequest, TextAiStreamChunk, TextAiToolCall, TextAiUsage } from "./types";

export interface ParsedSseTextEvent {
  readonly text?: string;
  readonly usage?: TextAiUsage;
  /** Tool calls the event completed; yielded even on the final event. */
  readonly toolCalls?: TextAiToolCall[];
  readonly done?: boolean;
}

/** Turn a call's streamed argument text into its arguments; a malformed or empty string is no arguments. */
export function parseToolArguments(json: string): Record<string, unknown> {
  if (!json.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Combine the caller's cancel signal with the per-attempt timeout signal that
 * retryWithBackoff hands each attempt (S6), so a hung call aborts its socket
 * instead of running on after the attempt has been abandoned.
 */
export function combineSignals(...signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const present = signals.filter((s): s is AbortSignal => s != null);
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  return AbortSignal.any(present);
}

/** An error the provider sent inside a stream; `status` when it gave a numeric code. */
export class ProviderStreamError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderStreamError";
  }
}

interface StreamErrorFields {
  type?: unknown;
  code?: unknown;
  message?: unknown;
}

function streamErrorKind(fields: StreamErrorFields): string {
  if (typeof fields.type === "string") return fields.type;
  if (typeof fields.code === "string" || typeof fields.code === "number") return String(fields.code);
  return "error";
}

function streamErrorDetail(error: unknown): { kind: string; message: string; status?: number } {
  if (typeof error === "string") return { kind: "error", message: error };
  const fields: StreamErrorFields = typeof error === "object" && error !== null ? error : {};
  return {
    kind: streamErrorKind(fields),
    message: typeof fields.message === "string" ? fields.message : "",
    ...(typeof fields.code === "number" ? { status: fields.code } : {}),
  };
}

/**
 * Throw the error a provider reported inside an HTTP 200 stream: Anthropic's
 * `error` event (`{"type":"error","error":{"type":"overloaded_error",...}}`)
 * or an OpenAI-compatible top-level `error` object. Read as an ordinary event
 * it carried no text, so the reply stopped mid-sentence, ended as if complete,
 * was saved as the coach's turn and counted as a breaker success during an
 * outage. Thrown, it fails the stream like any other provider error — AI3
 * (CODEBASE_ANALYSIS_2026-10-03). The breaker still reads it: an
 * `invalid_request_error` says nothing about the provider's health.
 */
export function throwIfStreamError(provider: string, payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const error = (payload as { error?: unknown }).error;
  if (!error) return;
  const detail = streamErrorDetail(error);
  throw new ProviderStreamError(
    `${provider} AI stream failed: ${detail.kind}: ${detail.message.slice(0, 500)}`,
    detail.status,
  );
}

export async function readJsonPayload(response: Response): Promise<unknown> {
  return response.json() as Promise<unknown>;
}

/**
 * Text of one content-array part: providers represent assistant text as
 * `{ text: string }` parts (possibly alongside non-text parts, which
 * contribute nothing).
 */
export function contentPartText(part: unknown): string {
  if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
    return (part as { text: string }).text;
  }
  return "";
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

function streamChunk(request: ResolvedTextAiRequest, event: ParsedSseTextEvent): TextAiStreamChunk | undefined {
  if (!event.text && !event.usage && !event.toolCalls?.length) return undefined;
  return {
    text: event.text,
    usage: event.usage,
    model: request.model,
    ...(event.toolCalls?.length ? { toolCalls: event.toolCalls } : {}),
  };
}

function* textChunksFromEvents(
  request: ResolvedTextAiRequest,
  events: string[],
  parseEvent: (event: string) => ParsedSseTextEvent,
): Generator<TextAiStreamChunk, boolean> {
  for (const event of events) {
    const parsed = parseEvent(event);
    const chunk = streamChunk(request, parsed);
    if (chunk) yield chunk;
    if (parsed.done) return true;
  }
  return false;
}

/**
 * Stream an SSE response as chunks. `finish`, when given, runs once the
 * stream ends without a final event, for calls still being assembled.
 */
export async function* streamSseTextChunks(
  request: ResolvedTextAiRequest,
  responsePromise: Promise<Response>,
  parseEvent: (event: string) => ParsedSseTextEvent,
  finish?: () => ParsedSseTextEvent | undefined,
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
    const last = finish?.();
    const chunk = last ? streamChunk(request, last) : undefined;
    if (chunk) yield chunk;
  } finally {
    reader.releaseLock();
  }
}
