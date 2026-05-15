import { afterEach, describe, expect, it, vi } from "vitest";

type EnvOverrides = Partial<typeof import("../../env").env>;

async function loadConfigWithEnv(overrides: EnvOverrides) {
  vi.resetModules();
  vi.doMock("../../env", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../env")>();
    return {
      ...actual,
      env: {
        ...actual.env,
        AI_TEXT_MODEL: undefined,
        AI_TEXT_FAST_MODEL: undefined,
        AI_TEXT_REASONING_MODEL: undefined,
        AI_TEXT_BASE_URL: undefined,
        AI_TEXT_API_KEY: undefined,
        OPENAI_API_KEY: undefined,
        ANTHROPIC_API_KEY: undefined,
        XAI_API_KEY: undefined,
        GROQ_API_KEY: undefined,
        TOGETHER_API_KEY: undefined,
        OPENROUTER_API_KEY: undefined,
        DEEPSEEK_API_KEY: undefined,
        ...overrides,
      },
    };
  });
  return import("./config");
}

describe("text AI provider config", () => {
  afterEach(() => {
    vi.doUnmock("../../env");
    vi.resetModules();
  });

  it("keeps Gemini legacy model and key fallbacks", async () => {
    const config = await loadConfigWithEnv({
      AI_TEXT_PROVIDER: "gemini",
      GEMINI_API_KEY: "gemini-key",
      GEMINI_MODEL: "legacy-fast",
      GEMINI_SUGGESTIONS_MODEL: "legacy-reasoning",
    });

    expect(config.resolveTextAiModel("gemini", "fast")).toBe("legacy-fast");
    expect(config.resolveTextAiModel("gemini", "reasoning")).toBe("legacy-reasoning");
    expect(config.configuredTextProviderHasApiKey()).toBe(true);
  });

  it("requires explicit models for non-Gemini providers", async () => {
    const config = await loadConfigWithEnv({
      AI_TEXT_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "anthropic-key",
    });

    expect(() => config.resolveTextAiModel("anthropic", "fast")).toThrow("AI text model is not configured");
    expect(config.configuredTextProviderHasApiKey()).toBe(false);
  });

  it("treats non-Gemini providers as ready only when a fast model can resolve", async () => {
    const config = await loadConfigWithEnv({
      AI_TEXT_PROVIDER: "anthropic",
      AI_TEXT_FAST_MODEL: "claude-sonnet-4-5",
      ANTHROPIC_API_KEY: "anthropic-key",
    });

    expect(config.configuredTextProviderHasApiKey()).toBe(true);
  });

  it("resolves xAI through the OpenAI-compatible profile defaults", async () => {
    const configModule = await loadConfigWithEnv({
      AI_TEXT_PROVIDER: "openai-compatible",
      AI_TEXT_OPENAI_COMPATIBLE_PROFILE: "xai",
      AI_TEXT_MODEL: "grok-4.3",
      XAI_API_KEY: "xai-key",
    });

    const config = configModule.getTextAiConfig();
    expect(config.openAiCompatibleBaseUrl).toBe("https://api.x.ai/v1");
    expect(config.openAiCompatibleApiKey).toBe("xai-key");
    expect(config.openAiCompatibleSupportsReasoningEffort).toBe(true);
    expect(configModule.resolveTextAiModel("openai-compatible", "reasoning")).toBe("grok-4.3");
    expect(configModule.configuredTextProviderHasApiKey()).toBe(true);
  });

  it("requires a base URL for custom OpenAI-compatible providers", async () => {
    const missingBaseUrl = await loadConfigWithEnv({
      AI_TEXT_PROVIDER: "openai-compatible",
      AI_TEXT_OPENAI_COMPATIBLE_PROFILE: "custom",
      AI_TEXT_MODEL: "custom-model",
      AI_TEXT_API_KEY: "custom-key",
    });

    expect(missingBaseUrl.configuredTextProviderHasApiKey()).toBe(false);

    const configured = await loadConfigWithEnv({
      AI_TEXT_PROVIDER: "openai-compatible",
      AI_TEXT_OPENAI_COMPATIBLE_PROFILE: "custom",
      AI_TEXT_MODEL: "custom-model",
      AI_TEXT_API_KEY: "custom-key",
      AI_TEXT_BASE_URL: "https://example.test/v1",
    });

    expect(configured.configuredTextProviderHasApiKey()).toBe(true);
    expect(configured.getTextAiConfig().openAiCompatibleBaseUrl).toBe("https://example.test/v1");
  });
});
