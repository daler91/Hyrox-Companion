import type { ResolvedTextAiRequest, TextAiStreamChunk } from "./types";

export function makeProviderRequest(
  overrides: Partial<ResolvedTextAiRequest> = {},
): ResolvedTextAiRequest {
  return {
    providerId: "openai-compatible",
    model: "test-model",
    modelRole: "reasoning",
    label: "unit",
    feature: "chat",
    systemInstruction: "System rules",
    messages: [{ role: "user", content: "Hello" }],
    ...overrides,
  };
}

export function mockJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export function requestJsonBody(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (typeof body !== "string") {
    throw new TypeError("Expected JSON request body to be a string");
  }
  return JSON.parse(body) as unknown;
}

export async function collectTextChunks(stream: AsyncGenerator<TextAiStreamChunk>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    if (chunk.text) chunks.push(chunk.text);
  }
  return chunks;
}
