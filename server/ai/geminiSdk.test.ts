import { afterEach, describe, expect, it, vi } from "vitest";

// getAiClient() reads env.AI_FEATURES_ENABLED and env.GEMINI_API_KEY at call
// time, and env.ts freezes its values at module load (Zod safeParse), so
// setting process.env from here would be too late. Mock the module per test
// instead, matching server/ai/providers/killSwitch.test.ts.
async function loadGeminiSdk(overrides: { aiFeaturesEnabled?: string; geminiApiKey?: string }) {
  vi.resetModules();
  vi.doMock("../env", () => ({
    env: {
      AI_FEATURES_ENABLED: overrides.aiFeaturesEnabled ?? "true",
      GEMINI_API_KEY: overrides.geminiApiKey ?? "test-gemini-key",
    },
  }));
  return import("./geminiSdk");
}

// Stub the SDK entry point so a successful getAiClient() call never tries to
// hit the real Gemini endpoint, and so the constructor call count is
// observable (server/gemini/client.test.ts uses the same stub-the-package
// approach for the same reason).
const constructorSpy = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(function (this: unknown, opts: unknown) {
    constructorSpy(opts);
    return { models: {} };
  }),
}));

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../env");
  constructorSpy.mockClear();
});

describe("getAiClient", () => {
  it("throws the kill-switch error when AI_FEATURES_ENABLED=false, without constructing a client", async () => {
    const mod = await loadGeminiSdk({ aiFeaturesEnabled: "false" });

    expect(() => mod.getAiClient()).toThrow(/AI features are disabled \(AI_FEATURES_ENABLED=false\)/);
    expect(constructorSpy).not.toHaveBeenCalled();
  });

  it("throws when no Gemini API key is configured", async () => {
    const mod = await loadGeminiSdk({ geminiApiKey: "" });

    expect(() => mod.getAiClient()).toThrow(/GEMINI_API_KEY is required for AI features/);
    expect(constructorSpy).not.toHaveBeenCalled();
  });

  it("builds the client once and reuses the same instance on later calls", async () => {
    const mod = await loadGeminiSdk({});

    const first = mod.getAiClient();
    const second = mod.getAiClient();

    expect(second).toBe(first);
    expect(constructorSpy).toHaveBeenCalledTimes(1);
    expect(constructorSpy).toHaveBeenCalledWith({ apiKey: "test-gemini-key" });
  });
});
