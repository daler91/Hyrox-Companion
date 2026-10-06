import { type ChatMessage } from "@shared/schema";

import type { ChatThread } from "../../storage/users";

export interface ChatHistoryStorage {
  getChatMessages: (
    userId: string,
    opts: { limit?: number; beforeTimestamp?: Date; beforeId?: string; thread?: ChatThread },
  ) => Promise<ChatMessage[]>;
}

/** Rows per page when the request names no limit (storage's default too). */
const DEFAULT_CHAT_HISTORY_PAGE_SIZE = 50;

export interface GetChatHistoryInput {
  userId: string;
  limit?: number;
  before?: string;
  beforeId?: string;
  /** A workout's conversation; the general one when both are absent (I4). */
  focusPlanDayId?: string;
  focusWorkoutLogId?: string;
}

export async function getChatHistoryUseCase(
  storage: ChatHistoryStorage,
  { userId, limit, before, beforeId, focusPlanDayId, focusWorkoutLogId }: GetChatHistoryInput,
): Promise<{ messages: ChatMessage[]; nextCursor?: { timestamp: string; id: string } }> {
  const pageSize = limit ?? DEFAULT_CHAT_HISTORY_PAGE_SIZE;
  const messages = await storage.getChatMessages(userId, {
    limit: pageSize,
    beforeTimestamp: before ? new Date(before) : undefined,
    beforeId,
    thread: { planDayId: focusPlanDayId, workoutLogId: focusWorkoutLogId },
  });

  // Only a full page can have rows older than it: the client offers "Load
  // older messages" while a cursor comes back, so one on every non-empty page
  // offered it on a three-message chat. CL56 (CODEBASE_ANALYSIS_2026-10-03)
  const oldest = messages.length >= pageSize ? messages[0] : undefined;
  const nextCursor = oldest?.timestamp
    ? { timestamp: oldest.timestamp.toISOString(), id: oldest.id }
    : undefined;

  return { messages, nextCursor };
}
