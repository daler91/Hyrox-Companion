import { retryWithBackoff } from "../../gemini/client";
import { readJsonPayload, streamSseTextChunks } from "./http";
import type {
  ResolvedTextAiRequest,
  TextAiProvider,
  TextAiResponse,
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
  return content
    .map((part) => {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
        return (part as { text: string }).text;
      }
      return "";
    })
    .join("");
}

function requestBody(request: ResolvedTextAiRequest, stream: boolean) {
  return {
    model: request.model,
    max_tokens: DEFAULT_MAX_TOKENS,
    stream,
    ...(anthropicSystemInstruction(request) ? { system: anthropicSystemInstruction(request) } : {}),
    messages: request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  };
}

async function postAnthropic(
  request: ResolvedTextAiRequest,
  options: AnthropicAdapterOptions,
  stream: boolean,
): Promise<Response> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": requireApiKey(options),
      "anthropic-version": ANTHROPIC_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody(request, stream)),
    signal: request.signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`anthropic AI request failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return response;
}

function streamChunkFromAnthropicEvent(
  payload: unknown,
  previousUsage: TextAiUsage | undefined,
): { text?: string; usage?: TextAiUsage } {
  const record = payload as {
    type?: string;
    delta?: { text?: unknown };
    usage?: { input_tokens?: number; output_tokens?: number };
    message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  };
  const usage = mergeAnthropicUsage(previousUsage, payload);
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
    },

    async generateText(request): Promise<TextAiResponse> {
      const response = await retryWithBackoff(
        () => postAnthropic(request, options, false),
        request.label,
        undefined,
        undefined,
        request.timeoutMs,
        request.timeoutMs,
      );
      const payload = await readJsonPayload(response);
      return {
        text: anthropicText(payload),
        model: request.model,
        usage: usageFromAnthropic(payload),
      };
    },

    async *streamText(request) {
      let usage: TextAiUsage | undefined;
      yield* streamSseTextChunks(request, postAnthropic(request, options, true), (event) => {
        const chunk = streamChunkFromAnthropicEvent(JSON.parse(event) as unknown, usage);
        if (chunk.usage) usage = chunk.usage;
        return chunk;
      });
    },
  };
}
