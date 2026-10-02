import { env } from "../../env";
import { recordAiUsage } from "../../services/aiUsageService";
import {
  assertBreakerClosed,
  recordBreakerFailure,
  recordBreakerSuccess,
} from "../circuitBreaker";
import { createAnthropicTextProvider } from "./anthropic";
import {
  configuredTextProviderHasApiKey,
  getTextAiConfig,
  resolveTextAiModel,
} from "./config";
import { geminiTextProvider } from "./gemini";
import { createOpenAiCompatibleTextProvider } from "./openaiCompatible";
import type {
  ResolvedTextAiRequest,
  TextAiProvider,
  TextAiRequest,
  TextAiResponse,
  TextAiStreamChunk,
  TextAiToolCall,
  TextAiUsage,
} from "./types";

export type {
  TextAiConversationMessage,
  TextAiMessage,
  TextAiModelRole,
  TextAiOpenAiCompatibleProfile,
  TextAiProviderId,
  TextAiReasoningEffort,
  TextAiRequest,
  TextAiResponse,
  TextAiTool,
  TextAiToolCall,
  TextAiToolResultMessage,
  TextAiUsage,
} from "./types";

/** What a streamed request with tools produces: text as it comes, then any calls. */
export interface TextAiStreamEvent {
  text?: string;
  toolCalls?: TextAiToolCall[];
  /** Gemini: the turn's parts, to send back with its calls. */
  providerParts?: unknown[];
}

let textAiProvider: TextAiProvider | null = null;

function buildTextAiProvider(): TextAiProvider {
  const config = getTextAiConfig();
  if (config.provider === "gemini") return geminiTextProvider;
  if (config.provider === "anthropic") {
    return createAnthropicTextProvider({ apiKey: config.anthropicApiKey });
  }
  return createOpenAiCompatibleTextProvider({
    apiKey: config.openAiCompatibleApiKey,
    baseUrl: config.openAiCompatibleBaseUrl,
    profile: config.openAiCompatibleProfile,
    supportsReasoningEffort: config.openAiCompatibleSupportsReasoningEffort,
  });
}

export function getTextAiProvider(): TextAiProvider {
  // Defense-in-depth for the AI kill switch (W25): gate the provider entrypoint
  // itself, not just the aiBudgetCheck HTTP middleware, so service/cron callers
  // that bypass the middleware also honor AI_FEATURES_ENABLED=false.
  if (env.AI_FEATURES_ENABLED === "false") {
    throw new Error("AI features are disabled (AI_FEATURES_ENABLED=false)");
  }
  textAiProvider ??= buildTextAiProvider();
  return textAiProvider;
}

export function __resetTextAiProviderForTests(): void {
  textAiProvider = null;
}

export function isTextAiProviderConfigured(): boolean {
  return configuredTextProviderHasApiKey();
}

function resolveRequest(request: TextAiRequest): ResolvedTextAiRequest {
  const config = getTextAiConfig();
  return {
    ...request,
    providerId: config.provider,
    model: resolveTextAiModel(config.provider, request.modelRole),
    reasoningEffort: request.reasoningEffort ?? config.reasoningEffort,
  };
}

function trackTextUsage(
  userId: string | undefined,
  feature: string | undefined,
  model: string,
  usage: TextAiUsage | undefined,
): void {
  if (!userId || !feature || !usage) return;
  void recordAiUsage(userId, model, feature, usage.inputTokens, usage.outputTokens);
}

export async function generateText(request: TextAiRequest): Promise<TextAiResponse> {
  const resolved = resolveRequest(request);
  const response = await getTextAiProvider().generateText(resolved);
  trackTextUsage(resolved.userId, resolved.feature, response.model, response.usage);
  return response;
}

export async function generateJsonText(request: Omit<TextAiRequest, "json">): Promise<TextAiResponse> {
  return generateText({ ...request, json: true });
}

async function* streamChunks(request: TextAiRequest): AsyncGenerator<TextAiStreamChunk> {
  const resolved = resolveRequest(request);
  // Streaming cannot go through retryWithBackoff — a retry would re-emit text
  // the caller has already received — but it still has to take part in the
  // circuit breaker, which retryWithBackoff was the only thing driving. Without
  // this the breaker is blind in both directions: streaming callers keep
  // hammering a provider it has already given up on, and their failures never
  // count toward opening it for anyone else.
  assertBreakerClosed();
  let latestUsage: TextAiUsage | undefined;
  let model = resolved.model;
  try {
    for await (const chunk of getTextAiProvider().streamText(resolved)) {
      model = chunk.model;
      if (chunk.usage) latestUsage = chunk.usage;
      yield chunk;
    }
    recordBreakerSuccess();
  } catch (error) {
    recordBreakerFailure(error);
    throw error;
  } finally {
    trackTextUsage(resolved.userId, resolved.feature, model, latestUsage);
  }
}

/**
 * Anthropic has no machine-enforced JSON mode, so a `json: true` response can
 * arrive inside a Markdown fence. generateJsonText unwraps it; a caller that
 * streams a JSON response unwraps the joined text with this once it ends. A
 * no-op on unfenced output.
 */
export { stripJsonCodeFence } from "./anthropic";

export async function* streamText(request: TextAiRequest): AsyncGenerator<string> {
  for await (const chunk of streamChunks(request)) {
    if (chunk.text) yield chunk.text;
  }
}

/**
 * Like {@link streamText}, for a request with tools: the text as it streams,
 * and the calls the model made once their arguments are complete.
 */
export async function* streamTextEvents(request: TextAiRequest): AsyncGenerator<TextAiStreamEvent> {
  for await (const chunk of streamChunks(request)) {
    if (chunk.text) yield { text: chunk.text };
    if (chunk.toolCalls?.length) {
      yield { toolCalls: chunk.toolCalls, ...(chunk.providerParts ? { providerParts: chunk.providerParts } : {}) };
    }
  }
}
