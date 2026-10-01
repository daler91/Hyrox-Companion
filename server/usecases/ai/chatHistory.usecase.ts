import { type ChatMessage } from "@shared/schema";

import type { ChatThread } from "../../storage/users";

export interface ChatHistoryStorage {
  getChatMessages: (
    userId: string,
    opts: { limit?: number; beforeTimestamp?: Date; beforeId?: string; thread?: ChatThread },
  ) => Promise<ChatMessage[]>;
}

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
  const messages = await storage.getChatMessages(userId, {
    limit,
    beforeTimestamp: before ? new Date(before) : undefined,
    beforeId,
    thread: { planDayId: focusPlanDayId, workoutLogId: focusWorkoutLogId },
  });

  const oldest = messages[0];
  const nextCursor = oldest?.timestamp
    ? { timestamp: oldest.timestamp.toISOString(), id: oldest.id }
    : undefined;

  return { messages, nextCursor };
}
