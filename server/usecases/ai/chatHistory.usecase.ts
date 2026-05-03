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
): Promise<{ messages: ChatMessage[]; hasMore: boolean; nextCursor?: { timestamp: string; id: string } }> {
  const requestedLimit = Math.min(Math.max(limit ?? 50, 1), 200);
  const page = await storage.getChatMessages(userId, {
    limit: requestedLimit + 1,
    beforeTimestamp: before ? new Date(before) : undefined,
    beforeId,
  });

  const hasMore = page.length > requestedLimit;
  const messages = hasMore ? page.slice(page.length - requestedLimit) : page;

  const oldest = messages[0];
  const nextCursor = oldest?.timestamp
    ? { timestamp: oldest.timestamp.toISOString(), id: oldest.id }
    : undefined;

  return { messages, hasMore, nextCursor };
}
