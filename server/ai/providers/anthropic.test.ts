import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAnthropicTextProvider } from "./anthropic";
import type { ResolvedTextAiRequest } from "./types";

vi.mock("../../gemini/client", () => ({
  retryWithBackoff: vi.fn((fn: () => Promise<unknown>) => fn()),
  withTimeout: <T>(promise: Promise<T>) => promise,
}));

const baseRequest: ResolvedTextAiRequest = {
  providerId: "anthropic",
  model: "claude-sonnet-4-5",
  modelRole: "reasoning",
  label: "unit",
  feature: "chat",
  systemInstruction: "System rules",
  messages: [{ role: "user", content: "Hello" }],
};

function mockJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("anthropic text provider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("maps canonical requests to the Messages API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockJsonResponse({
      content: [{ type: "text", text: "{\"ok\":true}" }],
      usage: { input_tokens: 13, output_tokens: 5 },
    }));

    const provider = createAnthropicTextProvider({ apiKey: "anthropic-key" });
    expect(provider.capabilities).toEqual({ jsonMode: false, streaming: true, reasoningEffort: false });
    const response = await provider.generateText({ ...baseRequest, json: true });

    expect(response).toEqual({
      text: "{\"ok\":true}",
      model: "claude-sonnet-4-5",
      usage: { inputTokens: 13, outputTokens: 5 },
    });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init?.headers).toMatchObject({
      "x-api-key": "anthropic-key",
      "anthropic-version": "2023-06-01",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "claude-sonnet-4-5",
      stream: false,
      system: expect.stringContaining("Return only valid JSON"),
      messages: [{ role: "user", content: "Hello" }],
    });
  });

  it("parses streamed content deltas", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(
      "event: content_block_delta\n" +
      "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Hel\"}}\n\n" +
      "event: content_block_delta\n" +
      "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"lo\"}}\n\n",
      { status: 200 },
    ));

    const provider = createAnthropicTextProvider({ apiKey: "anthropic-key" });
    const chunks: string[] = [];
    for await (const chunk of provider.streamText(baseRequest)) {
      if (chunk.text) chunks.push(chunk.text);
    }

    expect(chunks).toEqual(["Hel", "lo"]);
  });

  it("fails clearly when no API key is configured", async () => {
    const provider = createAnthropicTextProvider({});

    await expect(provider.generateText(baseRequest)).rejects.toThrow("ANTHROPIC_API_KEY");
  });
});
