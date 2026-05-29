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
  /**
   * Per-call override (ms) for the AI attempt timeout AND retry budget. When
   * unset, falls back to the global AI_CALL_TIMEOUT_MS / AI_REQUEST_TIMEOUT_MS.
   * Use only for slow background reasoning calls (e.g. plan generation) that
   * run inside a pg-boss job, never for synchronous request-path calls.
   */
  timeoutMs?: number;
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
