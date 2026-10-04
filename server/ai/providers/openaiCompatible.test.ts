import { beforeEach, describe, expect, it, vi } from "vitest";

import { isProviderHealthSignal } from "../circuitBreaker";
import { retryWithBackoff } from "../retry";
import { createOpenAiCompatibleTextProvider, unwrapArrayEnvelope } from "./openaiCompatible";
import { collectTextChunks, makeProviderRequest, mockJsonResponse, requestJsonBody } from "./testHelpers";
import type { TextAiStreamChunk } from "./types";

vi.mock("../retry", async () => (await import("./testHelpers")).mockRetryModule());

// Placeholder credential for the provider under test; never leaves the process.
const TEST_KEY = "test-key";

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
      apiKey: TEST_KEY,
      baseUrl: "https://api.x.ai/v1",
      profile: "xai",
      supportsReasoningEffort: true,
    });

    expect(provider.capabilities).toEqual({ jsonMode: true, streaming: true, reasoningEffort: true, tools: true });
    const response = await provider.generateText({ ...baseRequest, json: true, reasoningEffort: "high" });

    expect(response).toEqual({
      text: "{\"ok\":true}",
      model: "grok-4.3",
      usage: { inputTokens: 11, outputTokens: 7 },
    });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/chat/completions");
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${TEST_KEY}` });
    expect(requestJsonBody(init)).toMatchObject({
      model: "grok-4.3",
      response_format: { type: "json_object" },
      reasoning_effort: "high",
      messages: [
        // JSON mode adds how to wrap a top-level array (AI6, CODEBASE_ANALYSIS_2026-10-03).
        { role: "system", content: expect.stringMatching(/^System rules\n\nRespond with a single JSON object\./) as unknown },
        { role: "user", content: "Hello" },
      ],
    });
  });

  it("omits reasoning_effort for profiles that do not support it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockJsonResponse({
      choices: [{ message: { content: "ok" } }],
    }));
    const provider = createOpenAiCompatibleTextProvider({
      apiKey: TEST_KEY,
      baseUrl: "https://api.groq.com/openai/v1/",
      profile: "groq",
      supportsReasoningEffort: false,
    });

    expect(provider.capabilities.reasoningEffort).toBe(false);
    await provider.generateText({ ...baseRequest, reasoningEffort: "high" });

    expect(requestJsonBody(fetchSpy.mock.calls[0][1])).not.toHaveProperty("reasoning_effort");
    expect(fetchSpy.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
  });

  it("aborts the HTTP request when retry's per-attempt timeout fires", async () => {
    // retryWithBackoff abandons a timed-out attempt by aborting the signal it
    // passes in. The request must listen to it, or the hung call keeps its
    // socket open and runs on beside the retry.
    const attempt = new AbortController();
    vi.mocked(retryWithBackoff).mockImplementationOnce((fn) => fn(attempt.signal));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockJsonResponse({
      choices: [{ message: { content: "ok" } }],
    }));

    const provider = createOpenAiCompatibleTextProvider({
      apiKey: TEST_KEY,
      baseUrl: "https://api.x.ai/v1",
      profile: "xai",
      supportsReasoningEffort: true,
    });
    await provider.generateText(baseRequest);

    const signal = fetchSpy.mock.calls[0]?.[1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
    attempt.abort();
    expect(signal?.aborted).toBe(true);
  });

  it("parses streamed SSE deltas", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(
      "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n" +
      "data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n" +
      "data: [DONE]\n\n",
      { status: 200 },
    ));
    const provider = createOpenAiCompatibleTextProvider({
      apiKey: TEST_KEY,
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

  it("handles CRLF-framed SSE and EOF-terminated usage events", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(
      "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\r\n\r\n" +
      "data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\r\n\r\n" +
      "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2}}",
      { status: 200 },
    ));
    const provider = createOpenAiCompatibleTextProvider({
      apiKey: TEST_KEY,
      baseUrl: "https://api.x.ai/v1",
      profile: "xai",
      supportsReasoningEffort: true,
    });

    const chunks: TextAiStreamChunk[] = [];
    for await (const chunk of provider.streamText(baseRequest)) {
      chunks.push(chunk);
    }

    expect(chunks.map((chunk) => chunk.text).filter(Boolean)).toEqual(["Hel", "lo"]);
    expect(chunks.at(-1)?.usage).toEqual({ inputTokens: 3, outputTokens: 2 });
  });

  const TOOLS = [{ name: "get_workouts", description: "Logged sessions", parameters: { type: "object", properties: {} } }];

  it("sends tools, and a conversation's calls and results, in the chat completions shape", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("data: [DONE]\n\n", { status: 200 }));
    const provider = createOpenAiCompatibleTextProvider({ apiKey: TEST_KEY, baseUrl: "https://api.x.ai/v1", profile: "xai", supportsReasoningEffort: false });

    await collectTextChunks(provider.streamText({
      ...baseRequest,
      tools: TOOLS,
      toolChoice: "none",
      messages: [
        { role: "user", content: "What did I squat in July?" },
        { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "get_workouts", arguments: { from: "2026-07-01" } }] },
        { role: "tool", toolCallId: "call_1", name: "get_workouts", content: "{\"workouts\":[]}" },
      ],
    }));

    expect(requestJsonBody(fetchSpy.mock.calls[0][1])).toMatchObject({
      tools: [{ type: "function", function: { name: "get_workouts", description: "Logged sessions", parameters: { type: "object", properties: {} } } }],
      tool_choice: "none",
      messages: [
        { role: "system", content: "System rules" },
        { role: "user", content: "What did I squat in July?" },
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call_1", type: "function", function: { name: "get_workouts", arguments: "{\"from\":\"2026-07-01\"}" } }],
        },
        { role: "tool", tool_call_id: "call_1", content: "{\"workouts\":[]}" },
      ],
    });
  });

  it("assembles a streamed tool call from its pieces", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_9\",\"function\":{\"name\":\"get_workouts\",\"arguments\":\"{\\\"from\\\":\"}}]}}]}\n\n" +
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"2026-07-01\\\"}\"}}]}}]}\n\n" +
      "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n" +
      "data: [DONE]\n\n",
      { status: 200 },
    ));
    const provider = createOpenAiCompatibleTextProvider({ apiKey: TEST_KEY, baseUrl: "https://api.x.ai/v1", profile: "xai", supportsReasoningEffort: false });

    const calls = [];
    for await (const chunk of provider.streamText({ ...baseRequest, tools: TOOLS })) calls.push(...(chunk.toolCalls ?? []));

    expect(calls).toEqual([{ id: "call_9", name: "get_workouts", arguments: { from: "2026-07-01" } }]);
  });

  it("still hands over a tool call when the stream ends without saying why", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_2\",\"function\":{\"name\":\"get_personal_records\",\"arguments\":\"\"}}]}}]}",
      { status: 200 },
    ));
    const provider = createOpenAiCompatibleTextProvider({ apiKey: TEST_KEY, baseUrl: "https://api.x.ai/v1", profile: "xai", supportsReasoningEffort: false });

    const calls = [];
    for await (const chunk of provider.streamText({ ...baseRequest, tools: TOOLS })) calls.push(...(chunk.toolCalls ?? []));

    expect(calls).toEqual([{ id: "call_2", name: "get_personal_records", arguments: {} }]);
  });

  // AI3 (CODEBASE_ANALYSIS_2026-10-03): OpenAI-compatible APIs report a failure
  // that starts mid-reply as a top-level `error` inside the HTTP 200 stream.
  it("fails a stream that reports an error part-way through instead of ending it as complete", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(
      "data: {\"choices\":[{\"delta\":{\"content\":\"Your long run should\"}}]}\n\n" +
      "data: {\"error\":{\"message\":\"The server had an error while processing your request\",\"type\":\"server_error\"}}\n\n" +
      "data: [DONE]\n\n",
      { status: 200 },
    ));
    const provider = createOpenAiCompatibleTextProvider({ apiKey: TEST_KEY, baseUrl: "https://api.x.ai/v1", profile: "xai", supportsReasoningEffort: false });

    const received: string[] = [];
    const error: unknown = await (async () => {
      for await (const chunk of provider.streamText(baseRequest)) if (chunk.text) received.push(chunk.text);
    })().catch((caught: unknown) => caught);

    expect(received).toEqual(["Your long run should"]);
    expect(String(error)).toMatch(/openai-compatible xai AI stream failed: server_error/);
    expect(isProviderHealthSignal(error)).toBe(true);
  });

  it("reads a numeric in-stream error code as the status the breaker classifies by", async () => {
    // OpenRouter's shape: the upstream status as `code`, alongside finish_reason "error".
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(
      "data: {\"error\":{\"code\":400,\"message\":\"context length exceeded\"},\"choices\":[{\"delta\":{\"content\":\"\"},\"finish_reason\":\"error\"}]}\n\n",
      { status: 200 },
    ));
    const provider = createOpenAiCompatibleTextProvider({ apiKey: TEST_KEY, baseUrl: "https://openrouter.ai/api/v1", profile: "openrouter", supportsReasoningEffort: false });

    const error: unknown = await collectTextChunks(provider.streamText(baseRequest)).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 400 });
    expect(isProviderHealthSignal(error)).toBe(false);
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

// AI6 (CODEBASE_ANALYSIS_2026-10-03): json_object mode only returns an object,
// but the suggestions, review-notes and plan-generation prompts ask for a
// top-level array, and their parsers read an object as nothing.
describe("openai-compatible JSON mode and top-level arrays", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const provider = () =>
    createOpenAiCompatibleTextProvider({ apiKey: TEST_KEY, baseUrl: "https://api.openai.com/v1", profile: "openai", supportsReasoningEffort: false });

  it("hands back the array a JSON-mode reply wrapped, as array-expecting callers parse it", async () => {
    const days = [{ day: 1, focus: "Engine" }, { day: 2, focus: "Strength" }];
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockJsonResponse({
      choices: [{ message: { content: JSON.stringify({ jsonArray: days }) } }],
    }));

    const response = await provider().generateText({ ...baseRequest, json: true });

    const parsed: unknown = JSON.parse(response.text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toEqual(days);
  });

  it("tells the model how to wrap an array, since the API will not return one", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockJsonResponse({
      choices: [{ message: { content: "{\"jsonArray\":[]}" } }],
    }));

    const response = await provider().generateText({ ...baseRequest, json: true });

    expect(response.text).toBe("[]");
    const body = requestJsonBody(fetchSpy.mock.calls[0][1]) as { messages: { role: string; content: string }[] };
    expect(body.messages[0]).toMatchObject({ role: "system" });
    expect(body.messages[0].content).toMatch(/^System rules\n\n/);
    expect(body.messages[0].content).toMatch(/top-level JSON array, return \{"jsonArray": <that array>\} instead\./);
  });

  it("leaves a reply that is meant to be an object alone", () => {
    const multiKey = JSON.stringify({ summaryMessage: "Moved it", changes: [] });
    const recordOfText = JSON.stringify({ sections: { load: "Steady" } });
    const envelopeNotArray = JSON.stringify({ jsonArray: { day: 1 } });
    const envelopePlusKey = JSON.stringify({ jsonArray: [1], note: "extra" });
    expect(unwrapArrayEnvelope(multiKey)).toBe(multiKey);
    expect(unwrapArrayEnvelope(recordOfText)).toBe(recordOfText);
    expect(unwrapArrayEnvelope(envelopeNotArray)).toBe(envelopeNotArray);
    expect(unwrapArrayEnvelope(envelopePlusKey)).toBe(envelopePlusKey);
    expect(unwrapArrayEnvelope("[1,2]")).toBe("[1,2]");
    expect(unwrapArrayEnvelope("not json")).toBe("not json");
  });

  // A legitimate object reply can hold one array of its own: meal parsing's
  // warnings-only reply, exercise parsing's structure blocks. Only the fixed
  // `jsonArray` envelope is unwrapped, so these reach their parsers intact.
  it("passes a single-key object whose array is the reply's own field through untouched", async () => {
    const warningsOnly = JSON.stringify({ warnings: ["Could not read the portion size"] });
    const itemsOnly = JSON.stringify({ items: [{ name: "Oats", grams: 80 }] });
    expect(unwrapArrayEnvelope(warningsOnly)).toBe(warningsOnly);
    expect(unwrapArrayEnvelope(itemsOnly)).toBe(itemsOnly);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockJsonResponse({
      choices: [{ message: { content: warningsOnly } }],
    }));
    const response = await provider().generateText({ ...baseRequest, json: true });
    expect(response.text).toBe(warningsOnly);
  });

  it("neither instructs nor unwraps when JSON was not requested", async () => {
    const reply = JSON.stringify({ jsonArray: [1] });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockJsonResponse({
      choices: [{ message: { content: reply } }],
    }));

    const response = await provider().generateText(baseRequest);

    expect(response.text).toBe(reply);
    expect(requestJsonBody(fetchSpy.mock.calls[0][1])).toMatchObject({
      messages: [{ role: "system", content: "System rules" }, { role: "user", content: "Hello" }],
    });
  });
});
