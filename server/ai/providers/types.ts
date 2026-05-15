export type TextAiProviderId = "gemini" | "anthropic" | "openai-compatible";

export type TextAiOpenAiCompatibleProfile =
  | "openai"
  | "xai"
  | "groq"
  | "together"
  | "openrouter"
  | "deepseek"
  | "custom";

export type TextAiReasoningEffort = "none" | "low" | "medium" | "high";

export type TextAiModelRole = "fast" | "reasoning";

export interface TextAiMessage {
  role: "user" | "assistant";
  content: string;
}

export interface TextAiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface TextAiRequest {
  systemInstruction?: string;
  messages: TextAiMessage[];
  modelRole: TextAiModelRole;
  reasoningEffort?: TextAiReasoningEffort;
  json?: boolean;
  label: string;
  feature?: string;
  userId?: string;
  signal?: AbortSignal;
}

export interface ResolvedTextAiRequest extends TextAiRequest {
  model: string;
  providerId: TextAiProviderId;
}

export interface TextAiResponse {
  text: string;
  model: string;
  usage?: TextAiUsage;
}

export interface TextAiStreamChunk {
  text?: string;
  model: string;
  usage?: TextAiUsage;
}

export interface TextAiProvider {
  id: TextAiProviderId;
  capabilities: TextAiProviderCapabilities;
  generateText(request: ResolvedTextAiRequest): Promise<TextAiResponse>;
  streamText(request: ResolvedTextAiRequest): AsyncGenerator<TextAiStreamChunk>;
}

export interface TextAiProviderCapabilities {
  jsonMode: boolean;
  streaming: boolean;
  reasoningEffort: boolean;
}
