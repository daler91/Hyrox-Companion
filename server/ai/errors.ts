/**
 * An AI call this deployment is not set up to make: a missing API key, or AI
 * switched off. It fails the same way however healthy the provider is, so the
 * circuit breaker does not count it — with `AI_TEXT_PROVIDER=anthropic` and no
 * `GEMINI_API_KEY`, one coaching-material upload's failed embeddings used to
 * open the breaker and cut off every athlete's chat — AI2
 * (CODEBASE_ANALYSIS_2026-10-03).
 *
 * Kept free of imports so the SDK factory and adapters can throw it without
 * pulling the breaker's persistence in with it.
 */
export class AiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiConfigurationError";
  }
}
