import { textBreakerFor } from "../circuitBreaker";
import { AiConfigurationError } from "../errors";
import { retryWithBackoff } from "../retry";
import {
  combineSignals,
  contentPartText,
  type ParsedSseTextEvent,
  parseToolArguments,
  readJsonPayload,
  streamSseTextChunks,
  throwIfStreamError,
  trimTrailingSlashes,
} from "./http";
import type {
  ResolvedTextAiRequest,
  TextAiConversationMessage,
  TextAiOpenAiCompatibleProfile,
  TextAiProvider,
  TextAiResponse,
  TextAiToolCall,
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
    throw new AiConfigurationError(`AI_TEXT_API_KEY or the ${options.profile.toUpperCase()}_API_KEY environment variable is required for openai-compatible AI text provider`);
  }
  if (!options.baseUrl) {
    throw new AiConfigurationError("AI_TEXT_BASE_URL is required for custom openai-compatible AI text provider");
  }
  const baseUrl = trimTrailingSlashes(options.baseUrl);
  return { apiKey: options.apiKey, url: `${baseUrl}/chat/completions` };
}

function usageFromOpenAiCompatible(value: unknown): TextAiUsage | undefined {
  const usage = (value as { usage?: OpenAiCompatibleUsageShape } | undefined)?.usage;
  if (!usage) return undefined;
  // Unlike Gemini (AI4, CODEBASE_ANALYSIS_2026-10-03), OpenAI counts reasoning
  // inside completion_tokens / output_tokens; completion_tokens_details.reasoning_tokens
  // is a breakdown of it, so adding it would bill the thinking twice.
  return {
    inputTokens: usage.prompt_tokens ?? usage.input_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? usage.output_tokens ?? 0,
  };
}

function textFromOpenAiContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (typeof part === "string" ? part : contentPartText(part)))
    .join("");
}

function openAiMessage(message: TextAiConversationMessage) {
  if (message.role === "tool") {
    return { role: "tool" as const, tool_call_id: message.toolCallId, content: message.content };
  }
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant" as const,
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

function openAiMessages(systemInstruction: string | undefined, messages: TextAiConversationMessage[]) {
  return [
    ...(systemInstruction ? [{ role: "system" as const, content: systemInstruction }] : []),
    ...messages.map(openAiMessage),
  ];
}

function openAiTools(request: ResolvedTextAiRequest) {
  if (!request.tools?.length) return {};
  return {
    tools: request.tools.map((tool) => ({
      type: "function" as const,
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    })),
    tool_choice: request.toolChoice ?? "auto",
  };
}

/**
 * `response_format: json_object` only ever returns an object, but the
 * suggestions, review-notes and plan-generation prompts ask for a top-level
 * array, and their parsers read an object as nothing: plan generation failed
 * every billed chunk with "AI response is not an array", and suggestions and
 * review notes came back silently empty. So JSON mode tells the model to wrap
 * an array under one fixed key, and generateText hands the array back
 * (unwrapArrayEnvelope) — AI6 (CODEBASE_ANALYSIS_2026-10-03). Naming JSON here
 * also meets the API's rule that a json_object request mention it.
 */
const JSON_OBJECT_INSTRUCTION =
  'Respond with a single JSON object. If the instructions ask for a top-level JSON array, return {"jsonArray": <that array>} instead.';

function systemInstructionFor(request: ResolvedTextAiRequest): string | undefined {
  if (!request.json) return request.systemInstruction;
  return [request.systemInstruction, JSON_OBJECT_INSTRUCTION].filter(Boolean).join("\n\n");
}

/**
 * A JSON-mode reply whose only key is the `jsonArray` envelope becomes that
 * array; any other reply is returned untouched. Only the fixed key is unwrapped,
 * because a legitimate object reply can hold a single array of its own (meal
 * parsing's `{"warnings": [...]}`, exercise parsing's `{"structureBlocks": [...]}`)
 * and must reach its parser as it came. Exported for the regression test.
 */
export function unwrapArrayEnvelope(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return text;
  if (Object.keys(parsed).length !== 1 || !("jsonArray" in parsed)) return text;
  const value: unknown = parsed.jsonArray;
  return Array.isArray(value) ? JSON.stringify(value) : text;
}

function requestBody(request: ResolvedTextAiRequest, options: OpenAiCompatibleAdapterOptions, stream: boolean) {
  const reasoningEffort = request.reasoningEffort ?? "none";
  return {
    model: request.model,
    messages: openAiMessages(systemInstructionFor(request), request.messages),
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    ...(request.json ? { response_format: { type: "json_object" } } : {}),
    ...(options.supportsReasoningEffort && reasoningEffort !== "none" ? { reasoning_effort: reasoningEffort } : {}),
    ...openAiTools(request),
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
  attemptSignal?: AbortSignal,
): Promise<Response> {
  const { apiKey, url } = requireAdapterConfig(options);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody(request, options, stream)),
    signal: combineSignals(request.signal, attemptSignal),
    // Never follow a redirect. AI_TEXT_BASE_URL is checked against the SSRF
    // guard when it is parsed, and its host is re-resolved at startup, but
    // fetch's default `redirect: "follow"` would re-POST this body — which
    // carries athlete prompt data — to whatever Location the endpoint returns,
    // with no second guard check. A chat-completions endpoint has no legitimate
    // reason to redirect, so fail loudly instead.
    redirect: "error",
  });
  await assertOk(response, options.profile);
  return response;
}

interface ToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface StreamChoice {
  delta?: { content?: unknown; tool_calls?: ToolCallDelta[] };
  text?: unknown;
  finish_reason?: string | null;
}

/**
 * Tool calls arrive in pieces: an id and name first, then the arguments as
 * string fragments, keyed by index. They are complete once the stream says
 * it stopped to call them, or when it ends.
 */
function createToolCallAssembler() {
  const pending = new Map<number, { id: string; name: string; args: string }>();
  return {
    add(deltas: ToolCallDelta[] | undefined): void {
      for (const delta of deltas ?? []) {
        const index = delta.index ?? 0;
        const call = pending.get(index) ?? { id: "", name: "", args: "" };
        call.id ||= delta.id ?? "";
        call.name ||= delta.function?.name ?? "";
        call.args += delta.function?.arguments ?? "";
        pending.set(index, call);
      }
    },
    drain(): TextAiToolCall[] {
      const calls = [...pending.entries()]
        .sort(([a], [b]) => a - b)
        .filter(([, call]) => call.name)
        .map(([index, call]) => ({ id: call.id || `call_${index}`, name: call.name, arguments: parseToolArguments(call.args) }));
      pending.clear();
      return calls;
    },
  };
}

function streamEventFromPayload(
  payload: unknown,
  toolCalls: ReturnType<typeof createToolCallAssembler>,
): ParsedSseTextEvent {
  const choices = (payload as { choices?: unknown[] } | undefined)?.choices;
  const first = choices?.[0] as StreamChoice | undefined;
  toolCalls.add(first?.delta?.tool_calls);
  const content = first?.delta?.content ?? first?.text;
  const finished = first?.finish_reason === "tool_calls" ? toolCalls.drain() : [];
  return {
    text: textFromOpenAiContent(content) || undefined,
    usage: usageFromOpenAiCompatible(payload),
    ...(finished.length > 0 ? { toolCalls: finished } : {}),
  };
}

export function createOpenAiCompatibleTextProvider(options: OpenAiCompatibleAdapterOptions): TextAiProvider {
  return {
    id: "openai-compatible",
    capabilities: {
      jsonMode: true,
      streaming: true,
      reasoningEffort: options.supportsReasoningEffort,
      tools: true,
    },

    async generateText(request): Promise<TextAiResponse> {
      const response = await retryWithBackoff(
        (signal) => postJson(request, options, false, signal),
        request.label,
        textBreakerFor("openai-compatible"),
        undefined,
        undefined,
        request.timeoutMs,
        request.timeoutMs,
        request.signal,
      );
      const payload = await readJsonPayload(response);
      const text = parseOpenAiTextResponse(payload);
      return {
        text: request.json ? unwrapArrayEnvelope(text) : text,
        model: request.model,
        usage: usageFromOpenAiCompatible(payload),
      };
    },

    async *streamText(request) {
      const toolCalls = createToolCallAssembler();
      // A provider that ends without saying it stopped for tools still gets its calls.
      const flush = (): ParsedSseTextEvent => ({ toolCalls: toolCalls.drain() });
      yield* streamSseTextChunks(
        request,
        postJson(request, options, true),
        (event) => {
          if (event === "[DONE]") return { ...flush(), done: true };
          const payload = JSON.parse(event) as unknown;
          // A top-level `error` mid-stream is a failure, not an empty chunk —
          // AI3 (CODEBASE_ANALYSIS_2026-10-03).
          throwIfStreamError(`openai-compatible ${options.profile}`, payload);
          return streamEventFromPayload(payload, toolCalls);
        },
        flush,
      );
    },
  };
}
