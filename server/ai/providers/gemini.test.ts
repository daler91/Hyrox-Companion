import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAiClient } from "../geminiSdk";
import { collapseStreamedParts, geminiContents, geminiTextProvider } from "./gemini";
import { makeProviderRequest } from "./testHelpers";
import type { TextAiStreamChunk } from "./types";

vi.mock("../retry", async () => (await import("./testHelpers")).mockRetryModule());
vi.mock("../geminiSdk", () => ({ getAiClient: vi.fn() }));

const TOOLS = [{ name: "get_workouts", description: "Logged sessions", parameters: { type: "object", properties: {} } }];

/** A client whose stream yields these chunks, recording what it was asked. */
function mockStream(chunks: object[]) {
  const generateContentStream = vi.fn(() =>
    Promise.resolve(
      (async function* () {
        for (const chunk of chunks) yield chunk;
      })(),
    ),
  );
  vi.mocked(getAiClient).mockReturnValue({ models: { generateContentStream } } as never);
  return generateContentStream;
}

describe("gemini text provider tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("declares tools by their JSON Schema, and asks for text with toolChoice none", async () => {
    const stream = mockStream([]);
    const request = makeProviderRequest({ providerId: "gemini", model: "gemini-pro", tools: TOOLS, toolChoice: "none" });

    const chunks: TextAiStreamChunk[] = [];
    for await (const chunk of geminiTextProvider.streamText(request)) chunks.push(chunk);

    expect(chunks).toEqual([]);

    // The stub takes no parameters, but the provider passes it the request.
    const calls = stream.mock.calls as unknown[][];
    expect(calls.at(0)?.at(0)).toMatchObject({
      config: {
        tools: [{ functionDeclarations: [{ name: "get_workouts", description: "Logged sessions", parametersJsonSchema: { type: "object", properties: {} } }] }],
        toolConfig: { functionCallingConfig: { mode: "NONE" } },
      },
    });
  });

  it("streams the text, then the calls with the turn's parts to send back", async () => {
    mockStream([
      { candidates: [{ content: { parts: [{ text: "Let me " }] } }] },
      { candidates: [{ content: { parts: [{ text: "check." }] } }] },
      {
        candidates: [
          {
            content: {
              parts: [{ functionCall: { id: "fc-1", name: "get_workouts", args: { from: "2026-07-01" } }, thoughtSignature: "sig" }],
            },
          },
        ],
      },
    ]);
    const request = makeProviderRequest({ providerId: "gemini", model: "gemini-pro", tools: TOOLS });

    const chunks: TextAiStreamChunk[] = [];
    for await (const chunk of geminiTextProvider.streamText(request)) chunks.push(chunk);

    expect(chunks.map((chunk) => chunk.text).filter(Boolean)).toEqual(["Let me ", "check."]);
    const last = chunks.at(-1);
    expect(last?.toolCalls).toEqual([{ id: "fc-1", name: "get_workouts", arguments: { from: "2026-07-01" } }]);
    expect(last?.providerParts).toEqual([
      { text: "Let me check." },
      { functionCall: { id: "fc-1", name: "get_workouts", args: { from: "2026-07-01" } }, thoughtSignature: "sig" },
    ]);
  });

  it("never streams the model's thoughts as text", async () => {
    mockStream([{ candidates: [{ content: { parts: [{ text: "private reasoning", thought: true }, { text: "Answer." }] } }] }]);

    const chunks: TextAiStreamChunk[] = [];
    for await (const chunk of geminiTextProvider.streamText(makeProviderRequest({ providerId: "gemini", model: "gemini-pro" }))) {
      chunks.push(chunk);
    }

    expect(chunks.map((chunk) => chunk.text).filter(Boolean)).toEqual(["Answer."]);
  });
});

describe("geminiContents", () => {
  it("sends a tool-calling turn back as its own parts, and all its results in one user turn", () => {
    const parts = [{ functionCall: { id: "fc-1", name: "get_workouts", args: {} }, thoughtSignature: "sig" }];
    const contents = geminiContents(
      makeProviderRequest({
        providerId: "gemini",
        messages: [
          { role: "user", content: "What did I squat?" },
          { role: "assistant", content: "", toolCalls: [{ id: "fc-1", name: "get_workouts", arguments: {} }], providerParts: parts },
          { role: "tool", toolCallId: "fc-1", name: "get_workouts", content: "[]" },
          { role: "tool", toolCallId: "fc-2", name: "get_personal_records", content: "{}" },
        ],
      }),
    );

    expect(contents).toEqual([
      { role: "user", parts: [{ text: "What did I squat?" }] },
      { role: "model", parts },
      {
        role: "user",
        parts: [
          { functionResponse: { id: "fc-1", name: "get_workouts", response: { output: "[]" } } },
          { functionResponse: { id: "fc-2", name: "get_personal_records", response: { output: "{}" } } },
        ],
      },
    ]);
  });

  it("builds a calling turn's parts when the provider gave none", () => {
    const contents = geminiContents(
      makeProviderRequest({
        providerId: "gemini",
        messages: [{ role: "assistant", content: "Checking.", toolCalls: [{ id: "fc-1", name: "get_workouts", arguments: { from: "x" } }] }],
      }),
    );

    expect(contents).toEqual([
      { role: "model", parts: [{ text: "Checking." }, { functionCall: { id: "fc-1", name: "get_workouts", args: { from: "x" } } }] },
    ]);
  });
});

describe("collapseStreamedParts", () => {
  it("merges plain text and keeps signed or calling parts as they came", () => {
    expect(
      collapseStreamedParts([
        { text: "a" },
        { text: "b" },
        { text: "", thoughtSignature: "s1" },
        { text: "c" },
        { functionCall: { name: "x" } },
      ]),
    ).toEqual([{ text: "ab" }, { text: "", thoughtSignature: "s1" }, { text: "c" }, { functionCall: { name: "x" } }]);
  });
});
