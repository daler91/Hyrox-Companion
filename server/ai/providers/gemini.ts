import {
  type Content,
  FunctionCallingConfigMode,
  type GenerateContentResponse,
  type Part,
  ThinkingLevel,
} from "@google/genai";

import { AI_REQUEST_TIMEOUT_MS } from "../../constants";
import { getAiClient } from "../geminiSdk";
import { retryWithBackoff, withTimeout } from "../retry";
import { combineSignals } from "./http";
import type {
  ResolvedTextAiRequest,
  TextAiMessage,
  TextAiProvider,
  TextAiResponse,
  TextAiStreamChunk,
  TextAiToolCall,
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

/** An assistant turn: its own parts when it called tools (thought signatures and all), or its text. */
function modelParts(message: TextAiMessage): Part[] {
  if (message.providerParts?.length) return message.providerParts as Part[];
  return [
    ...(message.content ? [{ text: message.content }] : []),
    ...(message.toolCalls ?? []).map((call) => ({ functionCall: { id: call.id, name: call.name, args: call.arguments } })),
  ];
}

/**
 * The conversation as Gemini contents. Tool results go back as
 * `functionResponse` parts, all of one turn's in a single user content.
 */
export function geminiContents(request: ResolvedTextAiRequest): Content[] {
  const contents: Content[] = [];
  for (const message of request.messages) {
    if (message.role === "tool") {
      const part: Part = { functionResponse: { id: message.toolCallId, name: message.name, response: { output: message.content } } };
      const previous = contents.at(-1);
      if (previous?.role === "user" && previous.parts?.every((p) => p.functionResponse)) previous.parts.push(part);
      else contents.push({ role: "user", parts: [part] });
    } else if (message.role === "assistant") {
      contents.push({ role: "model", parts: modelParts(message) });
    } else {
      contents.push({ role: "user", parts: [{ text: message.content }] });
    }
  }
  return contents;
}

function geminiTools(request: ResolvedTextAiRequest) {
  if (!request.tools?.length) return {};
  return {
    tools: [
      {
        functionDeclarations: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parametersJsonSchema: tool.parameters,
        })),
      },
    ],
    toolConfig: {
      functionCallingConfig: {
        mode: request.toolChoice === "none" ? FunctionCallingConfigMode.NONE : FunctionCallingConfigMode.AUTO,
      },
    },
  };
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
    ...geminiTools(request),
  };
}

/** A chunk's answer text: its text parts, never its thoughts. */
function chunkText(parts: readonly Part[]): string {
  return parts.map((part) => (part.thought || typeof part.text !== "string" ? "" : part.text)).join("");
}

/**
 * A turn's parts as they go back to Gemini: streamed text merged into one
 * part, everything else (function calls, signatures) kept exactly.
 */
export function collapseStreamedParts(parts: readonly Part[]): Part[] {
  const collapsed: Part[] = [];
  for (const part of parts) {
    const previous = collapsed.at(-1);
    const plainText = (p: Part | undefined) =>
      p !== undefined && typeof p.text === "string" && !p.thought && !p.thoughtSignature && !p.functionCall;
    if (plainText(part) && plainText(previous) && previous) previous.text = `${previous.text ?? ""}${part.text ?? ""}`;
    else collapsed.push({ ...part });
  }
  return collapsed;
}

function toolCallsFrom(parts: readonly Part[]): TextAiToolCall[] {
  return parts.flatMap((part, index) => {
    const call = part.functionCall;
    if (!call?.name) return [];
    return [{ id: call.id ?? `call_${index}`, name: call.name, arguments: call.args ?? {} }];
  });
}

export const geminiTextProvider: TextAiProvider = {
  id: "gemini",
  capabilities: {
    jsonMode: true,
    streaming: true,
    reasoningEffort: true,
    tools: true,
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

    // Every part of the turn, so tool calls go back with their signatures.
    const parts: Part[] = [];
    for await (const chunk of stream) {
      if (request.signal?.aborted) return;
      const chunkParts = chunk.candidates?.[0]?.content?.parts ?? [];
      parts.push(...chunkParts);
      yield {
        text: chunkText(chunkParts) || undefined,
        model: request.model,
        usage: usageFromGeminiResponse(chunk),
      };
    }
    const toolCalls = toolCallsFrom(parts);
    if (toolCalls.length > 0) {
      yield { model: request.model, toolCalls, providerParts: collapseStreamedParts(parts) };
    }
  },
};
