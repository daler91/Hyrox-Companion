import { beforeEach, describe, expect, it, vi } from "vitest";

import { createOpenAiCompatibleTextProvider } from "./openaiCompatible";
import { collectTextChunks, makeProviderRequest, mockJsonResponse, requestJsonBody } from "./testHelpers";

vi.mock("../../gemini/client", () => ({
  retryWithBackoff: vi.fn((fn: () => Promise<unknown>) => fn()),
  withTimeout: <T>(promise: Promise<T>) => promise,
}));

const baseRequest = makeProviderRequest({
  providerId: "openai-compatible",
  model: "grok-4.3",
});

describe("openai-compatible text provider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("maps canonical text requests to chat completions JSON mode", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockJsonResponse({
      choices: [{ message: { content: "{\"ok\":true}" } }],
      usage: { prompt_tokens: 11, completion_tokens: 7 },
    }));

    const provider = createOpenAiCompatibleTextProvider({
      apiKey: "test-key",
      baseUrl: "https://api.x.ai/v1",
      profile: "xai",
      supportsReasoningEffort: true,
    });

    expect(provider.capabilities).toEqual({ jsonMode: true, streaming: true, reasoningEffort: true });
    const response = await provider.generateText({ ...baseRequest, json: true, reasoningEffort: "high" });

    expect(response).toEqual({
      text: "{\"ok\":true}",
      model: "grok-4.3",
      usage: { inputTokens: 11, outputTokens: 7 },
    });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/chat/completions");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer test-key" });
    expect(requestJsonBody(init)).toMatchObject({
      model: "grok-4.3",
      response_format: { type: "json_object" },
      reasoning_effort: "high",
      messages: [
        { role: "system", content: "System rules" },
        { role: "user", content: "Hello" },
      ],
    });
  });

  it("omits reasoning_effort for profiles that do not support it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockJsonResponse({
      choices: [{ message: { content: "ok" } }],
    }));
    const provider = createOpenAiCompatibleTextProvider({
      apiKey: "test-key",
      baseUrl: "https://api.groq.com/openai/v1/",
      profile: "groq",
      supportsReasoningEffort: false,
    });

    expect(provider.capabilities.reasoningEffort).toBe(false);
    await provider.generateText({ ...baseRequest, reasoningEffort: "high" });

    expect(requestJsonBody(fetchSpy.mock.calls[0][1])).not.toHaveProperty("reasoning_effort");
    expect(fetchSpy.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
  });

  it("parses streamed SSE deltas", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(
      "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n" +
      "data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n" +
      "data: [DONE]\n\n",
      { status: 200 },
    ));
    const provider = createOpenAiCompatibleTextProvider({
      apiKey: "test-key",
      baseUrl: "https://api.x.ai/v1",
      profile: "xai",
      supportsReasoningEffort: true,
    });

    const chunks = await collectTextChunks(provider.streamText(baseRequest));
    expect(chunks).toEqual(["Hel", "lo"]);
    expect(requestJsonBody(fetchSpy.mock.calls[0][1])).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it("fails clearly when no compatible API key is configured", async () => {
    const provider = createOpenAiCompatibleTextProvider({
      baseUrl: "https://api.x.ai/v1",
      profile: "xai",
      supportsReasoningEffort: true,
    });

    await expect(provider.generateText(baseRequest)).rejects.toThrow("AI_TEXT_API_KEY");
  });
});
