import { GoogleGenAI } from "@google/genai";

import { env } from "../env";
import { AiConfigurationError } from "./errors";

let _ai: GoogleGenAI | null = null;
export function getAiClient(): GoogleGenAI {
  // Defense-in-depth for the AI kill switch (W25). The aiBudgetCheck middleware
  // already rejects HTTP requests when AI_FEATURES_ENABLED=false, but provider
  // entrypoints are also reached from cron jobs and services that don't pass
  // through that middleware — gate here too so nothing calls the provider.
  //
  // Both are configuration errors, thrown inside retryWithBackoff: the breaker
  // must not read them as a Gemini outage — AI2 (CODEBASE_ANALYSIS_2026-10-03).
  if (env.AI_FEATURES_ENABLED === "false") {
    throw new AiConfigurationError("AI features are disabled (AI_FEATURES_ENABLED=false)");
  }
  if (!_ai) {
    if (!env.GEMINI_API_KEY) {
      throw new AiConfigurationError("GEMINI_API_KEY is required for AI features");
    }
    _ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }
  return _ai;
}
