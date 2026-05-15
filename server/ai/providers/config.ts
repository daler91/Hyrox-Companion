import { env } from "../../env";
import type {
  TextAiModelRole,
  TextAiOpenAiCompatibleProfile,
  TextAiProviderId,
  TextAiReasoningEffort,
} from "./types";

interface OpenAiCompatibleProfileConfig {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly supportsReasoningEffort: boolean;
}

export const OPENAI_COMPATIBLE_PROFILES: Record<TextAiOpenAiCompatibleProfile, OpenAiCompatibleProfileConfig> = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    apiKey: env.OPENAI_API_KEY,
    supportsReasoningEffort: true,
  },
  xai: {
    baseUrl: "https://api.x.ai/v1",
    apiKey: env.XAI_API_KEY,
    supportsReasoningEffort: true,
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    apiKey: env.GROQ_API_KEY,
    supportsReasoningEffort: false,
  },
  together: {
    baseUrl: "https://api.together.xyz/v1",
    apiKey: env.TOGETHER_API_KEY,
    supportsReasoningEffort: false,
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: env.OPENROUTER_API_KEY,
    supportsReasoningEffort: false,
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: env.DEEPSEEK_API_KEY,
    supportsReasoningEffort: false,
  },
  custom: {
    baseUrl: "",
    apiKey: undefined,
    supportsReasoningEffort: false,
  },
};

export interface TextAiConfig {
  readonly provider: TextAiProviderId;
  readonly openAiCompatibleProfile: TextAiOpenAiCompatibleProfile;
  readonly reasoningEffort: TextAiReasoningEffort;
  readonly openAiCompatibleBaseUrl: string;
  readonly openAiCompatibleApiKey?: string;
  readonly anthropicApiKey?: string;
  readonly openAiCompatibleSupportsReasoningEffort: boolean;
}

export function getTextAiConfig(): TextAiConfig {
  const profile = env.AI_TEXT_OPENAI_COMPATIBLE_PROFILE;
  const profileConfig = OPENAI_COMPATIBLE_PROFILES[profile];
  return {
    provider: env.AI_TEXT_PROVIDER,
    openAiCompatibleProfile: profile,
    reasoningEffort: env.AI_TEXT_REASONING_EFFORT,
    openAiCompatibleBaseUrl: env.AI_TEXT_BASE_URL || profileConfig.baseUrl,
    openAiCompatibleApiKey: env.AI_TEXT_API_KEY || profileConfig.apiKey,
    anthropicApiKey: env.AI_TEXT_API_KEY || env.ANTHROPIC_API_KEY,
    openAiCompatibleSupportsReasoningEffort: profileConfig.supportsReasoningEffort,
  };
}

export function resolveTextAiModel(provider: TextAiProviderId, role: TextAiModelRole): string {
  if (role === "fast") {
    const fast = env.AI_TEXT_FAST_MODEL || env.AI_TEXT_MODEL;
    if (fast) return fast;
    if (provider === "gemini") return env.GEMINI_MODEL;
  } else {
    const reasoning = env.AI_TEXT_REASONING_MODEL || env.AI_TEXT_MODEL;
    if (reasoning) return reasoning;
    if (provider === "gemini") return env.GEMINI_SUGGESTIONS_MODEL;
  }

  throw new Error(
    `AI text model is not configured for provider "${provider}". Set AI_TEXT_MODEL or the role-specific AI_TEXT_${role === "fast" ? "FAST" : "REASONING"}_MODEL.`,
  );
}

export function configuredTextProviderHasApiKey(): boolean {
  const config = getTextAiConfig();
  try {
    resolveTextAiModel(config.provider, "fast");
  } catch {
    return false;
  }

  if (config.provider === "gemini") return Boolean(env.GEMINI_API_KEY);
  if (config.provider === "anthropic") return Boolean(config.anthropicApiKey);
  return Boolean(config.openAiCompatibleApiKey && config.openAiCompatibleBaseUrl);
}
