import { type GenerateContentResponse, ThinkingLevel } from "@google/genai";

import { AI_REQUEST_TIMEOUT_MS } from "../../constants";
import { getAiClient, retryWithBackoff, withTimeout } from "../../gemini/client";
import type {
  ResolvedTextAiRequest,
  TextAiProvider,
  TextAiResponse,
  TextAiStreamChunk,
  TextAiUsage,
} from "./types";

function usageFromGeminiResponse(response: GenerateContentResponse): TextAiUsage | undefined {
  const usage = response.usageMetadata;
  if (!usage) return undefined;
  return {
    inputTokens: usage.promptTokenCount ?? 0,
    outputTokens: usage.candidatesTokenCount ?? 0,
  };
}

function geminiThinkingLevel(request: ResolvedTextAiRequest): ThinkingLevel | undefined {
  if (request.reasoningEffort === "none") return undefined;
  if (request.reasoningEffort === "low") return ThinkingLevel.LOW;
  if (request.reasoningEffort === "medium") return ThinkingLevel.MEDIUM;
  return ThinkingLevel.HIGH;
}

function geminiContents(request: ResolvedTextAiRequest) {
  return request.messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));
}

/** Combine the caller's cancel signal with the per-call timeout signal (S6). */
function combineSignals(...signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const present = signals.filter((s): s is AbortSignal => s != null);
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  return AbortSignal.any(present);
}

function geminiConfig(request: ResolvedTextAiRequest, timeoutSignal?: AbortSignal) {
  const thinkingLevel = geminiThinkingLevel(request);
  // Merge the external cancel signal (request.signal) with the timeout-driven
  // signal from retryWithBackoff so a hung call aborts the socket (S6).
  const abortSignal = combineSignals(request.signal, timeoutSignal);
  return {
    ...(request.systemInstruction ? { systemInstruction: request.systemInstruction } : {}),
    ...(request.json ? { responseMimeType: "application/json" } : {}),
    ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
    ...(abortSignal ? { abortSignal } : {}),
  };
}

export const geminiTextProvider: TextAiProvider = {
  id: "gemini",
  capabilities: {
    jsonMode: true,
    streaming: true,
    reasoningEffort: true,
  },

  async generateText(request): Promise<TextAiResponse> {
    const response = await retryWithBackoff(
      (signal) =>
        getAiClient().models.generateContent({
          model: request.model,
          config: geminiConfig(request, signal),
          contents: geminiContents(request),
        }),
      request.label,
      undefined,
      undefined,
      request.timeoutMs,
      request.timeoutMs,
    );

    return {
      text: response.text || "",
      model: request.model,
      usage: usageFromGeminiResponse(response),
    };
  },

  async *streamText(request): AsyncGenerator<TextAiStreamChunk> {
    const stream: AsyncGenerator<GenerateContentResponse> = await withTimeout(
      getAiClient().models.generateContentStream({
        model: request.model,
        config: geminiConfig(request),
        contents: geminiContents(request),
      }),
      AI_REQUEST_TIMEOUT_MS,
      request.label,
    );

    for await (const chunk of stream) {
      if (request.signal?.aborted) return;
      yield {
        text: chunk.text || undefined,
        model: request.model,
        usage: usageFromGeminiResponse(chunk),
      };
    }
  },
};
