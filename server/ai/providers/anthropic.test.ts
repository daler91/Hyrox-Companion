import { beforeEach, describe, expect, it, vi } from "vitest";

import { retryWithBackoff } from "../retry";
import { createAnthropicTextProvider, stripJsonCodeFence } from "./anthropic";
import { collectTextChunks, makeProviderRequest, mockJsonResponse, requestJsonBody } from "./testHelpers";
import type { TextAiStreamChunk } from "./types";

vi.mock("../retry", async () => (await import("./testHelpers")).mockRetryModule());

const baseRequest = makeProviderRequest({
  providerId: "anthropic",
  model: "claude-sonnet-4-5",
});

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
    expect(provider.capabilities).toEqual({ jsonMode: false, streaming: true, reasoningEffort: false, tools: true });
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
    expect(requestJsonBody(init)).toMatchObject({
      model: "claude-sonnet-4-5",
      stream: false,
      system: expect.stringContaining("Return only valid JSON"),
      messages: [{ role: "user", content: "Hello" }],
    });
  });

  it("aborts the HTTP request when retry's per-attempt timeout fires", async () => {
    // retryWithBackoff abandons a timed-out attempt by aborting the signal it
    // passes in. The request must listen to it, or the hung call keeps its
    // socket open and runs on beside the retry.
    const attempt = new AbortController();
    vi.mocked(retryWithBackoff).mockImplementationOnce((fn) => fn(attempt.signal));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockJsonResponse({
      content: [{ type: "text", text: "ok" }],
    }));

    const provider = createAnthropicTextProvider({ apiKey: "anthropic-key" });
    await provider.generateText(baseRequest);

    const signal = fetchSpy.mock.calls[0]?.[1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
    attempt.abort();
    expect(signal?.aborted).toBe(true);
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
    const chunks = await collectTextChunks(provider.streamText(baseRequest));
    expect(chunks).toEqual(["Hel", "lo"]);
  });

  it("preserves token totals across partial streaming usage events", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(
      "event: message_start\n" +
      "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":17,\"output_tokens\":1}}}\n\n" +
      "event: content_block_delta\n" +
      "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi\"}}\n\n" +
      "event: message_delta\n" +
      "data: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":5}}\n\n",
      { status: 200 },
    ));

    const provider = createAnthropicTextProvider({ apiKey: "anthropic-key" });
    const chunks: TextAiStreamChunk[] = [];
    for await (const chunk of provider.streamText(baseRequest)) {
      chunks.push(chunk);
    }

    expect(chunks.map((chunk) => chunk.text).filter(Boolean)).toEqual(["Hi"]);
    expect(chunks.at(-1)?.usage).toEqual({ inputTokens: 17, outputTokens: 5 });
  });

  const TOOLS = [{ name: "get_workouts", description: "Logged sessions", parameters: { type: "object", properties: {} } }];

  it("sends tools, and a conversation's calls and results, as tool_use and tool_result blocks", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 200 }));
    const provider = createAnthropicTextProvider({ apiKey: "anthropic-key" });

    await collectTextChunks(provider.streamText({
      ...baseRequest,
      tools: TOOLS,
      messages: [
        { role: "user", content: "What did I squat in July?" },
        {
          role: "assistant",
          content: "Let me look.",
          toolCalls: [
            { id: "toolu_1", name: "get_workouts", arguments: { from: "2026-07-01" } },
            { id: "toolu_2", name: "get_personal_records", arguments: {} },
          ],
        },
        { role: "tool", toolCallId: "toolu_1", name: "get_workouts", content: "[]" },
        { role: "tool", toolCallId: "toolu_2", name: "get_personal_records", content: "{}" },
      ],
    }));

    expect(requestJsonBody(fetchSpy.mock.calls[0][1])).toMatchObject({
      tools: [{ name: "get_workouts", description: "Logged sessions", input_schema: { type: "object", properties: {} } }],
      tool_choice: { type: "auto" },
      messages: [
        { role: "user", content: "What did I squat in July?" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me look." },
            { type: "tool_use", id: "toolu_1", name: "get_workouts", input: { from: "2026-07-01" } },
            { type: "tool_use", id: "toolu_2", name: "get_personal_records", input: {} },
          ],
        },
        // Both results in one user turn, as the API requires.
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_1", content: "[]" },
            { type: "tool_result", tool_use_id: "toolu_2", content: "{}" },
          ],
        },
      ],
    });
  });

  it("assembles a streamed tool_use block into a call", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(
      "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n" +
      "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Checking.\"}}\n\n" +
      "data: {\"type\":\"content_block_stop\",\"index\":0}\n\n" +
      "data: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_7\",\"name\":\"get_workouts\",\"input\":{}}}\n\n" +
      "data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"from\\\": \\\"2026-07\"}}\n\n" +
      "data: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"-01\\\"}\"}}\n\n" +
      "data: {\"type\":\"content_block_stop\",\"index\":1}\n\n",
      { status: 200 },
    ));
    const provider = createAnthropicTextProvider({ apiKey: "anthropic-key" });

    const chunks: TextAiStreamChunk[] = [];
    for await (const chunk of provider.streamText({ ...baseRequest, tools: TOOLS })) chunks.push(chunk);

    expect(chunks.map((chunk) => chunk.text).filter(Boolean)).toEqual(["Checking."]);
    expect(chunks.flatMap((chunk) => chunk.toolCalls ?? [])).toEqual([
      { id: "toolu_7", name: "get_workouts", arguments: { from: "2026-07-01" } },
    ]);
  });

  it("fails clearly when no API key is configured", async () => {
    const provider = createAnthropicTextProvider({});

    await expect(provider.generateText(baseRequest)).rejects.toThrow("ANTHROPIC_API_KEY");
  });
});

describe("anthropic JSON responses", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /** One Messages-API reply carrying `text`, read back through generateText. */
  async function textFor(text: string, json: boolean): Promise<string> {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockJsonResponse({
      content: [{ type: "text", text }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const provider = createAnthropicTextProvider({ apiKey: "anthropic-key" });
    const response = await provider.generateText({ ...baseRequest, json });
    return response.text;
  }

  it("unwraps a fenced JSON reply so callers can parse it", async () => {
    // Anthropic has no JSON mode — the adapter can only ask for unfenced JSON,
    // and the model fences anyway often enough that every caller's JSON.parse
    // would throw on the backticks.
    await expect(textFor('```json\n{"ok":true}\n```', true)).resolves.toBe('{"ok":true}');
    await expect(textFor('```\n{"ok":true}\n```', true)).resolves.toBe('{"ok":true}');
  });

  it("leaves an already-raw JSON reply untouched", async () => {
    await expect(textFor('{"ok":true}', true)).resolves.toBe('{"ok":true}');
  });

  it("does not unwrap fences when JSON was not requested", async () => {
    // A fenced code block is legitimate output for a prose request.
    await expect(textFor('```js\nconst a = 1;\n```', false)).resolves.toBe('```js\nconst a = 1;\n```');
  });

  it("leaves a reply whose fence does not wrap the whole response alone", () => {
    // Prose around a snippet is not a JSON payload; reinterpreting it would
    // hand the caller something the model never claimed to return.
    const mixed = 'Here you go:\n```json\n{"ok":true}\n```\nHope that helps.';
    expect(stripJsonCodeFence(mixed)).toBe(mixed);
  });

  it("stays linear on an unclosed fence (no catastrophic backtracking)", () => {
    // A truncated reply is an opening fence with nothing closing it. The regex
    // this replaced was cubic on exactly that shape — 145ms at 1k trailing
    // spaces, 1.1s at 2k, 8.8s at 4k — because its whitespace classes and lazy
    // body all matched the same characters. 20k spaces would have taken hours;
    // the bound below is ~5000x what the slicing version needs.
    const truncated = "```" + " ".repeat(20_000);
    const started = performance.now();
    expect(stripJsonCodeFence(truncated)).toBe(truncated);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("unwraps a fence whose body is only whitespace", () => {
    // The degenerate closed case, adjacent to the one above: it must terminate
    // AND still be treated as an empty payload rather than passed through.
    expect(stripJsonCodeFence("```json\n   \n```")).toBe("");
    expect(stripJsonCodeFence("``````")).toBe("");
  });
});
