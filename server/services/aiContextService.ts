import type { RagInfo } from "@shared/schema";
import type { Logger } from "pino";

import type { TrainingContext } from "../gemini/index";
import { logger as rootLogger } from "../logger";
import { buildCoachingMaterialsSection, buildRetrievedChunksSection, type CoachingMaterialInput } from "../prompts";
import { buildTrainingContext } from "./ai";
import type { ConversationTurn } from "./chatConversation";
import { retrieveCoachingContext } from "./ragRetrieval";

type AIContextLogger = Pick<Logger, "warn" | "error">;

export interface AIContext {
  trainingContext: TrainingContext;
  coachingMaterials?: CoachingMaterialInput[];
  retrievedChunks?: string[];
  ragInfo: RagInfo;
}

/** What a turn with nothing to retrieve for carries: no materials, and says so. */
const NO_RETRIEVAL = { ragInfo: { source: "none", chunkCount: 0 } } as const satisfies Pick<AIContext, "ragInfo">;

/**
 * Build shared AI context (training stats + RAG coaching materials)
 * used by both chat and suggestion endpoints. A null query retrieves nothing
 * (chat passes it for "thanks!").
 */
export async function buildAIContext(
  userId: string,
  query: string | null,
  log: AIContextLogger = rootLogger,
): Promise<AIContext> {
  const [trainingContext, coachingContext] = await Promise.all([
    buildTrainingContext(userId),
    query === null ? NO_RETRIEVAL : retrieveCoachingContext(userId, query, log),
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
  history: ConversationTurn[];
}
