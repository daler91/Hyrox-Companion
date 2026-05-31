import { env } from "../../env";
import { recordAiUsage } from "../../services/aiUsageService";
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
  TextAiUsage,
} from "./types";

export type {
  TextAiMessage,
  TextAiModelRole,
  TextAiOpenAiCompatibleProfile,
  TextAiProviderId,
  TextAiReasoningEffort,
  TextAiRequest,
  TextAiResponse,
  TextAiUsage,
} from "./types";

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

export async function* streamText(request: TextAiRequest): AsyncGenerator<string> {
  const resolved = resolveRequest(request);
  let latestUsage: TextAiUsage | undefined;
  let model = resolved.model;
  try {
    for await (const chunk of getTextAiProvider().streamText(resolved)) {
      model = chunk.model;
      if (chunk.usage) latestUsage = chunk.usage;
      if (chunk.text) yield chunk.text;
    }
  } finally {
    trackTextUsage(resolved.userId, resolved.feature, model, latestUsage);
  }
}
