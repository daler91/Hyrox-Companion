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

/** A function the model may call (AI coach chat review, I8). */
export interface TextAiTool {
  name: string;
  description: string;
  /** A JSON Schema object describing the arguments. */
  parameters: Record<string, unknown>;
}

/** A call the model made, with its arguments parsed. */
export interface TextAiToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface TextAiMessage {
  role: "user" | "assistant";
  content: string;
  /** An assistant turn that called tools. */
  toolCalls?: TextAiToolCall[];
  /**
   * The provider's own parts for this turn, sent back verbatim: Gemini needs
   * the thought signatures that came with its function calls.
   */
  providerParts?: unknown[];
}

/** What a tool returned, for the call with `toolCallId`. */
export interface TextAiToolResultMessage {
  role: "tool";
  toolCallId: string;
  name: string;
  content: string;
}

export type TextAiConversationMessage = TextAiMessage | TextAiToolResultMessage;

export interface TextAiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface TextAiRequest {
  systemInstruction?: string;
  messages: TextAiConversationMessage[];
  modelRole: TextAiModelRole;
  /** Functions the model may call; streaming only. */
  tools?: TextAiTool[];
  /** "none" keeps the declared tools but asks for a text answer. */
  toolChoice?: "auto" | "none";
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
  /** Calls whose arguments have fully arrived. */
  toolCalls?: TextAiToolCall[];
  /** Gemini: this turn's parts, to send back with its tool calls. */
  providerParts?: unknown[];
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
  /** Function calling on streamed requests. */
  tools: boolean;
}
