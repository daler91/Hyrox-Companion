import type { ChatMessage,RagInfo } from "@shared/schema";
import type { Logger } from "pino";

import type { TrainingContext } from "../gemini/index";
import { logger as rootLogger } from "../logger";
import { buildCoachingMaterialsSection, buildRetrievedChunksSection, type CoachingMaterialInput } from "../prompts";
import { buildTrainingContext } from "./ai";
import { retrieveCoachingContext } from "./ragRetrieval";

export interface AIContext {
  trainingContext: TrainingContext;
  coachingMaterials?: CoachingMaterialInput[];
  retrievedChunks?: string[];
  ragInfo: RagInfo;
}

/**
 * Build shared AI context (training stats + RAG coaching materials)
 * used by both chat and suggestion endpoints.
 */
export async function buildAIContext(
  userId: string,
  query: string,
  log: Logger = rootLogger,
): Promise<AIContext> {
  const [trainingContext, coachingContext] = await Promise.all([
    buildTrainingContext(userId),
    retrieveCoachingContext(userId, query, log),
  ]);

  return {
    trainingContext,
    ...coachingContext,
  };
}

/**
 * Build the coaching materials string for the suggestions prompt from an AIContext.
 */
export function extractCoachingMaterialsText(ctx: AIContext): string | undefined {
  if (ctx.retrievedChunks && ctx.retrievedChunks.length > 0) {
    return buildRetrievedChunksSection(ctx.retrievedChunks);
  }
  if (ctx.coachingMaterials) {
    return buildCoachingMaterialsSection(ctx.coachingMaterials) || undefined;
  }
  return undefined;
}

export interface ChatInput {
  message: string;
  history: Pick<ChatMessage, "role" | "content">[];
}
