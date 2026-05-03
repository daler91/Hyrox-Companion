import { type ChatMessage } from "@shared/schema";

export interface ChatHistoryStorage {
  getChatMessages: (
    userId: string,
    opts: { limit?: number; beforeTimestamp?: Date; beforeId?: string },
  ) => Promise<ChatMessage[]>;
}

export interface GetChatHistoryInput {
  userId: string;
  limit?: number;
  before?: string;
  beforeId?: string;
}

export async function getChatHistoryUseCase(
  storage: ChatHistoryStorage,
  { userId, limit, before, beforeId }: GetChatHistoryInput,
): Promise<{ messages: ChatMessage[]; nextCursor?: { timestamp: string; id: string } }> {
  const messages = await storage.getChatMessages(userId, {
    limit,
    beforeTimestamp: before ? new Date(before) : undefined,
    beforeId,
  });

  const oldest = messages[0];
  const nextCursor = oldest?.timestamp
    ? { timestamp: oldest.timestamp.toISOString(), id: oldest.id }
    : undefined;

  return { messages, nextCursor };
}
