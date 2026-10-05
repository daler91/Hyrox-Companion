import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// The provider facade is where every text call's tokens reach recordAiUsage,
// and both budget caps (per athlete and app-wide) are sums of what it records.
// Nothing tested that it records at all, and the compiler cannot tell either,
// since a request's userId and feature are optional: a change that stopped
// recording would have switched both caps off with CI green — AI19
// (CODEBASE_ANALYSIS_2026-10-03).
// ---------------------------------------------------------------------------

const { providerGenerate, providerStream, recordAiUsage } = vi.hoisted(() => ({
  providerGenerate: vi.fn(),
  providerStream: vi.fn(),
  recordAiUsage: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../sharedRuntimeState", () => ({
  getRuntimeCache: vi.fn(() => Promise.resolve()),
  setRuntimeCache: vi.fn(() => Promise.resolve()),
}));

vi.mock("./config", () => ({
  getTextAiConfig: () => ({ provider: "gemini", reasoningEffort: "high" }),
  resolveTextAiModel: () => "requested-model",
  configuredTextProviderHasApiKey: () => true,
}));

vi.mock("./gemini", () => ({
  geminiTextProvider: {
    generateText: (request: unknown) => providerGenerate(request),
    streamText: (request: unknown) => providerStream(request),
  },
}));

vi.mock("../../services/aiUsageService", () => ({ recordAiUsage }));

import { __resetCircuitBreakerForTests } from "../circuitBreaker";
import {
  __resetTextAiProviderForTests,
  generateJsonText,
  generateText,
  streamText,
  type TextAiRequest,
} from "./index";

const request: TextAiRequest = {
  label: "unit",
  messages: [{ role: "user", content: "How was my week?" }],
  modelRole: "fast",
  userId: "user-1",
  feature: "coach_chat",
};

/** Read a stream to its end, returning the error it threw, if any. */
async function drain(): Promise<unknown> {
  try {
    for await (const _text of streamText(request)) {
      // Only the side effects matter here.
    }
  } catch (error) {
    return error;
  }
  return null;
}

describe("the text facade records each call's usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetCircuitBreakerForTests();
    __resetTextAiProviderForTests();
  });

  it.each([
    ["generateText", generateText],
    ["generateJsonText", generateJsonText],
  ])("%s bills the athlete and feature for the model that answered", async (_name, call) => {
    providerGenerate.mockResolvedValue({
      text: "{}",
      model: "answering-model-002",
      usage: { inputTokens: 1200, outputTokens: 340 },
    });

    await call(request);

    expect(recordAiUsage).toHaveBeenCalledOnce();
    expect(recordAiUsage).toHaveBeenCalledWith(
      "user-1",
      "answering-model-002",
      "coach_chat",
      1200,
      340,
    );
  });

  it("bills a stream once, with the last usage it reported", async () => {
    providerStream.mockImplementation(async function* () {
      yield {
        text: "Solid ",
        model: "answering-model-002",
        usage: { inputTokens: 900, outputTokens: 2 },
      };
      await Promise.resolve();
      yield {
        text: "week.",
        model: "answering-model-002",
        usage: { inputTokens: 900, outputTokens: 75 },
      };
    });

    await expect(drain()).resolves.toBeNull();

    expect(recordAiUsage).toHaveBeenCalledOnce();
    expect(recordAiUsage).toHaveBeenCalledWith(
      "user-1",
      "answering-model-002",
      "coach_chat",
      900,
      75,
    );
  });

  it("still bills a stream that failed part-way for the tokens it used", async () => {
    providerStream.mockImplementation(async function* () {
      yield {
        text: "Solid ",
        model: "answering-model-002",
        usage: { inputTokens: 900, outputTokens: 2 },
      };
      await Promise.resolve();
      throw new Error("503 upstream unavailable");
    });

    await expect(drain()).resolves.toMatchObject({ message: "503 upstream unavailable" });

    expect(recordAiUsage).toHaveBeenCalledWith(
      "user-1",
      "answering-model-002",
      "coach_chat",
      900,
      2,
    );
  });
});
