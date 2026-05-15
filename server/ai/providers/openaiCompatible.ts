import { retryWithBackoff } from "../../gemini/client";
import { readJsonPayload, streamSseTextChunks, trimTrailingSlashes } from "./http";
import type {
  ResolvedTextAiRequest,
  TextAiMessage,
  TextAiOpenAiCompatibleProfile,
  TextAiProvider,
  TextAiResponse,
  TextAiUsage,
} from "./types";

interface OpenAiCompatibleAdapterOptions {
  readonly apiKey?: string;
  readonly baseUrl: string;
  readonly profile: TextAiOpenAiCompatibleProfile;
  readonly supportsReasoningEffort: boolean;
}

interface OpenAiCompatibleUsageShape {
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
}

function requireAdapterConfig(options: OpenAiCompatibleAdapterOptions): { apiKey: string; url: string } {
  if (!options.apiKey) {
    throw new Error(`AI_TEXT_API_KEY or the ${options.profile.toUpperCase()}_API_KEY environment variable is required for openai-compatible AI text provider`);
  }
  if (!options.baseUrl) {
    throw new Error("AI_TEXT_BASE_URL is required for custom openai-compatible AI text provider");
  }
  const baseUrl = trimTrailingSlashes(options.baseUrl);
  return { apiKey: options.apiKey, url: `${baseUrl}/chat/completions` };
}

function usageFromOpenAiCompatible(value: unknown): TextAiUsage | undefined {
  const usage = (value as { usage?: OpenAiCompatibleUsageShape } | undefined)?.usage;
  if (!usage) return undefined;
  return {
    inputTokens: usage.prompt_tokens ?? usage.input_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? usage.output_tokens ?? 0,
  };
}

function textFromOpenAiContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
        return (part as { text: string }).text;
      }
      return "";
    })
    .join("");
}

function openAiMessages(systemInstruction: string | undefined, messages: TextAiMessage[]) {
  return [
    ...(systemInstruction ? [{ role: "system" as const, content: systemInstruction }] : []),
    ...messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];
}

function requestBody(request: ResolvedTextAiRequest, options: OpenAiCompatibleAdapterOptions, stream: boolean) {
  const reasoningEffort = request.reasoningEffort ?? "none";
  return {
    model: request.model,
    messages: openAiMessages(request.systemInstruction, request.messages),
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    ...(request.json ? { response_format: { type: "json_object" } } : {}),
    ...(options.supportsReasoningEffort && reasoningEffort !== "none" ? { reasoning_effort: reasoningEffort } : {}),
  };
}

async function assertOk(response: Response, profile: TextAiOpenAiCompatibleProfile): Promise<void> {
  if (response.ok) return;
  const text = await response.text().catch(() => "");
  throw new Error(`openai-compatible ${profile} AI request failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
}

function parseOpenAiTextResponse(payload: unknown): string {
  const choices = (payload as { choices?: unknown[] } | undefined)?.choices;
  const first = choices?.[0] as { message?: { content?: unknown }; text?: unknown } | undefined;
  if (!first) return "";
  if (typeof first.text === "string") return first.text;
  return textFromOpenAiContent(first.message?.content);
}

async function postJson(
  request: ResolvedTextAiRequest,
  options: OpenAiCompatibleAdapterOptions,
  stream: boolean,
): Promise<Response> {
  const { apiKey, url } = requireAdapterConfig(options);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody(request, options, stream)),
    signal: request.signal,
  });
  await assertOk(response, options.profile);
  return response;
}

function streamTextFromPayload(payload: unknown): { text?: string; usage?: TextAiUsage } {
  const choices = (payload as { choices?: unknown[] } | undefined)?.choices;
  const first = choices?.[0] as { delta?: { content?: unknown }; text?: unknown } | undefined;
  const content = first?.delta?.content ?? first?.text;
  return {
    text: textFromOpenAiContent(content) || undefined,
    usage: usageFromOpenAiCompatible(payload),
  };
}

export function createOpenAiCompatibleTextProvider(options: OpenAiCompatibleAdapterOptions): TextAiProvider {
  return {
    id: "openai-compatible",
    capabilities: {
      jsonMode: true,
      streaming: true,
      reasoningEffort: options.supportsReasoningEffort,
    },

    async generateText(request): Promise<TextAiResponse> {
      const response = await retryWithBackoff(
        () => postJson(request, options, false),
        request.label,
      );
      const payload = await readJsonPayload(response);
      return {
        text: parseOpenAiTextResponse(payload),
        model: request.model,
        usage: usageFromOpenAiCompatible(payload),
      };
    },

    async *streamText(request) {
      yield* streamSseTextChunks(request, postJson(request, options, true), (event) => {
        if (event === "[DONE]") return { done: true };
        return streamTextFromPayload(JSON.parse(event) as unknown);
      });
    },
  };
}
