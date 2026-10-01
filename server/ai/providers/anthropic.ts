import { retryWithBackoff } from "../retry";
import {
  combineSignals,
  contentPartText,
  type ParsedSseTextEvent,
  parseToolArguments,
  readJsonPayload,
  streamSseTextChunks,
} from "./http";
import type {
  ResolvedTextAiRequest,
  TextAiConversationMessage,
  TextAiProvider,
  TextAiResponse,
  TextAiToolCall,
  TextAiToolResultMessage,
  TextAiUsage,
} from "./types";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 16_384;

interface AnthropicAdapterOptions {
  readonly apiKey?: string;
}

function requireApiKey(options: AnthropicAdapterOptions): string {
  if (!options.apiKey) {
    throw new Error("ANTHROPIC_API_KEY or AI_TEXT_API_KEY is required for anthropic AI text provider");
  }
  return options.apiKey;
}

function anthropicSystemInstruction(request: ResolvedTextAiRequest): string | undefined {
  const system = request.systemInstruction ?? "";
  if (!request.json) return system || undefined;
  return [
    system,
    "Return only valid JSON. Do not wrap the JSON in Markdown fences or add explanatory prose.",
  ].filter(Boolean).join("\n\n");
}

interface AnthropicUsageFields {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

function usageFieldsFromAnthropic(value: unknown): AnthropicUsageFields | undefined {
  const usage =
    (value as { usage?: { input_tokens?: number; output_tokens?: number } } | undefined)?.usage
    ?? (value as { message?: { usage?: { input_tokens?: number; output_tokens?: number } } } | undefined)?.message?.usage;
  if (!usage) return undefined;
  const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : undefined;
  const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : undefined;
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return { inputTokens, outputTokens };
}

function usageFromAnthropic(value: unknown): TextAiUsage | undefined {
  const usage = usageFieldsFromAnthropic(value);
  if (!usage) return undefined;
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
  };
}

function mergeAnthropicUsage(
  previous: TextAiUsage | undefined,
  value: unknown,
): TextAiUsage | undefined {
  const usage = usageFieldsFromAnthropic(value);
  if (!usage) return undefined;
  return {
    inputTokens: usage.inputTokens ?? previous?.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? previous?.outputTokens ?? 0,
  };
}

function anthropicText(value: unknown): string {
  const content = (value as { content?: unknown[] } | undefined)?.content;
  if (!Array.isArray(content)) return "";
  return content.map(contentPartText).join("");
}

const FENCE = "```";

/**
 * Strip one wrapping Markdown code fence from a JSON response.
 *
 * Gemini and the OpenAI-compatible providers get a machine-enforced JSON mode
 * (`responseMimeType` / `response_format`), so their output is raw by
 * construction. Anthropic's Messages API has no such mode — the best this
 * adapter can do is ASK for unfenced JSON in the system instruction, and a
 * request is not a guarantee. When the model fences anyway, every caller's
 * `JSON.parse` throws on the leading backticks, and the request has already
 * been paid for. Unwrapping here keeps the `json: true` contract the same
 * across providers instead of leaving each caller to discover the difference.
 *
 * Only a fence that wraps the WHOLE response is removed: a fence in the middle
 * means the model returned prose we should not silently reinterpret.
 *
 * Deliberately string slicing rather than one regex. The obvious pattern
 * anchors a lazy body between two fences with optional whitespace on each side,
 * which is super-linear (Sonar S5852): the whitespace classes and the lazy body
 * all match the same characters, so on an UNCLOSED fence the engine tries every
 * split between them. Measured at 145ms / 1.1s / 8.8s for 1k / 2k / 4k trailing
 * spaces — cubic, and a truncated model reply is exactly that shape. The
 * slicing below is linear and matches that pattern case for case.
 *
 * Exported for the regression test.
 */
export function stripJsonCodeFence(text: string): string {
  const trimmed = text.trim();
  // Shorter than two fences can't be a wrapped block ("``````" is the minimum).
  if (trimmed.length < 6 || !trimmed.startsWith(FENCE) || !trimmed.endsWith(FENCE)) return text;
  const inner = trimmed.slice(FENCE.length, -FENCE.length);
  // Drop the language tag when the model labelled the block.
  const body = inner.slice(0, 4).toLowerCase() === "json" ? inner.slice(4) : inner;
  return body.trim();
}

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

function toolResultBlock(message: TextAiToolResultMessage): AnthropicContentBlock {
  return { type: "tool_result", tool_use_id: message.toolCallId, content: message.content };
}

/**
 * Messages in Anthropic's shape: an assistant turn that called tools carries
 * `tool_use` blocks, and the results go back in ONE user turn of
 * `tool_result` blocks, as the API requires.
 */
function anthropicMessages(messages: TextAiConversationMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const message of messages) {
    if (message.role === "tool") {
      const previous = out.at(-1);
      if (previous?.role === "user" && Array.isArray(previous.content)) previous.content.push(toolResultBlock(message));
      else out.push({ role: "user", content: [toolResultBlock(message)] });
    } else if (message.role === "assistant" && message.toolCalls?.length) {
      out.push({
        role: "assistant",
        content: [
          ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
          ...message.toolCalls.map((call) => ({ type: "tool_use" as const, id: call.id, name: call.name, input: call.arguments })),
        ],
      });
    } else {
      out.push({ role: message.role, content: message.content });
    }
  }
  return out;
}

function anthropicTools(request: ResolvedTextAiRequest) {
  if (!request.tools?.length) return {};
  return {
    tools: request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })),
    tool_choice: { type: request.toolChoice ?? "auto" },
  };
}

function requestBody(request: ResolvedTextAiRequest, stream: boolean) {
  return {
    model: request.model,
    max_tokens: DEFAULT_MAX_TOKENS,
    stream,
    ...(anthropicSystemInstruction(request) ? { system: anthropicSystemInstruction(request) } : {}),
    messages: anthropicMessages(request.messages),
    ...anthropicTools(request),
  };
}

async function postAnthropic(
  request: ResolvedTextAiRequest,
  options: AnthropicAdapterOptions,
  stream: boolean,
  attemptSignal?: AbortSignal,
): Promise<Response> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": requireApiKey(options),
      "anthropic-version": ANTHROPIC_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody(request, stream)),
    signal: combineSignals(request.signal, attemptSignal),
    // See the note in openaiCompatible.ts: a redirect would re-POST the prompt
    // body to an unvalidated host. The URL here is a constant, so this is
    // belt-and-braces, but the two adapters should behave identically.
    redirect: "error",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`anthropic AI request failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return response;
}

interface AnthropicStreamEvent {
  type?: string;
  index?: number;
  content_block?: { type?: string; id?: string; name?: string };
  delta?: { type?: string; text?: unknown; partial_json?: unknown };
}

/**
 * A `tool_use` block streams as a start (id, name), `input_json_delta`
 * fragments, and a stop, keyed by block index; its call is complete at the stop.
 */
function createToolUseAssembler() {
  const pending = new Map<number, { id: string; name: string; json: string }>();
  return {
    accept(event: AnthropicStreamEvent): TextAiToolCall | undefined {
      const index = event.index ?? 0;
      if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
        pending.set(index, { id: event.content_block.id ?? `call_${index}`, name: event.content_block.name ?? "", json: "" });
      } else if (event.type === "content_block_delta" && typeof event.delta?.partial_json === "string") {
        const call = pending.get(index);
        if (call) call.json += event.delta.partial_json;
      } else if (event.type === "content_block_stop") {
        const call = pending.get(index);
        pending.delete(index);
        if (call?.name) return { id: call.id, name: call.name, arguments: parseToolArguments(call.json) };
      }
      return undefined;
    },
  };
}

function streamChunkFromAnthropicEvent(
  payload: unknown,
  previousUsage: TextAiUsage | undefined,
  toolUses: ReturnType<typeof createToolUseAssembler>,
): ParsedSseTextEvent {
  const record = payload as AnthropicStreamEvent;
  const usage = mergeAnthropicUsage(previousUsage, payload);
  const toolCall = toolUses.accept(record);
  if (toolCall) return { usage, toolCalls: [toolCall] };
  if (record.type === "content_block_delta" && typeof record.delta?.text === "string") {
    return { text: record.delta.text, usage };
  }
  return { usage };
}

export function createAnthropicTextProvider(options: AnthropicAdapterOptions): TextAiProvider {
  return {
    id: "anthropic",
    capabilities: {
      jsonMode: false,
      streaming: true,
      reasoningEffort: false,
      tools: true,
    },

    async generateText(request): Promise<TextAiResponse> {
      const response = await retryWithBackoff(
        (signal) => postAnthropic(request, options, false, signal),
        request.label,
        undefined,
        undefined,
        request.timeoutMs,
        request.timeoutMs,
      );
      const payload = await readJsonPayload(response);
      const text = anthropicText(payload);
      return {
        text: request.json ? stripJsonCodeFence(text) : text,
        model: request.model,
        usage: usageFromAnthropic(payload),
      };
    },

    async *streamText(request) {
      let usage: TextAiUsage | undefined;
      const toolUses = createToolUseAssembler();
      yield* streamSseTextChunks(request, postAnthropic(request, options, true), (event) => {
        const chunk = streamChunkFromAnthropicEvent(JSON.parse(event) as unknown, usage, toolUses);
        if (chunk.usage) usage = chunk.usage;
        return chunk;
      });
    },
  };
}
