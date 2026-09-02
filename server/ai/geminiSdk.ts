import { GoogleGenAI } from "@google/genai";

import { env } from "../env";

let _ai: GoogleGenAI | null = null;
export function getAiClient(): GoogleGenAI {
  // Defense-in-depth for the AI kill switch (W25). The aiBudgetCheck middleware
  // already rejects HTTP requests when AI_FEATURES_ENABLED=false, but provider
  // entrypoints are also reached from cron jobs and services that don't pass
  // through that middleware — gate here too so nothing calls the provider.
  if (env.AI_FEATURES_ENABLED === "false") {
    throw new Error("AI features are disabled (AI_FEATURES_ENABLED=false)");
  }
  if (!_ai) {
    if (!env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is required for AI features");
    }
    _ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }
  return _ai;
}
