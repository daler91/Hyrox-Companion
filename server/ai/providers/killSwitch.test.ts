import { afterEach, describe, expect, it, vi } from "vitest";

// W25 — the AI kill switch must be enforced at the provider entrypoint, not
// only in the aiBudgetCheck HTTP middleware, so service/cron callers can't
// reach a provider when AI_FEATURES_ENABLED=false.

async function loadProviders(aiEnabled: string) {
  vi.resetModules();
  vi.doMock("../../env", () => ({
    env: {
      AI_FEATURES_ENABLED: aiEnabled,
      AI_TEXT_PROVIDER: "gemini",
      AI_TEXT_REASONING_EFFORT: "high",
      GEMINI_API_KEY: "test-key",
      // The provider graph transitively imports db.ts, which requires a
      // DATABASE_URL at module load (the pool itself connects lazily).
      DATABASE_URL: "postgres://user:pass@localhost:5432/test",
    },
  }));
  return import("./index");
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../../env");
});

describe("AI kill switch at provider entrypoint (W25)", () => {
  it("throws from getTextAiProvider when AI_FEATURES_ENABLED=false", async () => {
    const mod = await loadProviders("false");
    expect(() => mod.getTextAiProvider()).toThrow(/AI features are disabled/);
  });

  it("does not raise the kill-switch error when AI_FEATURES_ENABLED=true", async () => {
    const mod = await loadProviders("true");
    // May still fail for unrelated config reasons in a bare test env, but it
    // must never be the kill-switch error.
    try {
      mod.getTextAiProvider();
    } catch (error) {
      expect(String(error)).not.toMatch(/AI features are disabled/);
    }
  });
});
