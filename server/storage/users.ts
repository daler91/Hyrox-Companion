import {
  users,
  chatMessages,
  stravaConnections,
  customExercises,
  type User,
  type UpsertUser,
  type UpdateUserPreferences,
  type ChatMessage,
  type InsertChatMessage,
  type StravaConnection,
  type InsertStravaConnection,
  type CustomExercise,
  type InsertCustomExercise,
} from "@shared/schema";
import { encryptToken, decryptToken } from "../crypto";
import { db } from "../db";
import { eq, and, isNotNull } from "drizzle-orm";

export class UserStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async updateUserPreferences(
    userId: string,
    preferences: UpdateUserPreferences,
  ): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({
        ...preferences,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  async getChatMessages(userId: string): Promise<ChatMessage[]> {
    return await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.userId, userId))
      .orderBy(chatMessages.timestamp);
  }

  async saveChatMessage(message: InsertChatMessage): Promise<ChatMessage> {
    const [chatMessage] = await db
      .insert(chatMessages)
      .values(message)
      .returning();
    return chatMessage;
  }

  async clearChatHistory(userId: string): Promise<boolean> {
    await db.delete(chatMessages).where(eq(chatMessages.userId, userId));
    return true;
  }

  async getStravaConnection(
    userId: string,
  ): Promise<StravaConnection | undefined> {
    const [connection] = await db
      .select()
      .from(stravaConnections)
      .where(eq(stravaConnections.userId, userId));

    if (connection) {
      return {
        ...connection,
        accessToken: decryptToken(connection.accessToken),
        refreshToken: decryptToken(connection.refreshToken),
      };
    }
    return connection;
  }

  async upsertStravaConnection(
    data: InsertStravaConnection,
  ): Promise<StravaConnection> {
    const encryptedData = {
      ...data,
      accessToken: encryptToken(data.accessToken),
      refreshToken: encryptToken(data.refreshToken),
    };

    const [connection] = await db
      .insert(stravaConnections)
      .values(encryptedData)
      .onConflictDoUpdate({
        target: stravaConnections.userId,
        set: {
          stravaAthleteId: encryptedData.stravaAthleteId,
          accessToken: encryptedData.accessToken,
          refreshToken: encryptedData.refreshToken,
          expiresAt: encryptedData.expiresAt,
          scope: encryptedData.scope,
        },
      })
      .returning();

    return {
      ...connection,
      accessToken: decryptToken(connection.accessToken),
      refreshToken: decryptToken(connection.refreshToken),
    };
  }

  async deleteStravaConnection(userId: string): Promise<boolean> {
    const result = await db
      .delete(stravaConnections)
      .where(eq(stravaConnections.userId, userId));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async updateStravaLastSync(userId: string): Promise<void> {
    await db
      .update(stravaConnections)
      .set({ lastSyncedAt: new Date() })
      .where(eq(stravaConnections.userId, userId));
  }

  async getCustomExercises(userId: string): Promise<CustomExercise[]> {
    return await db
      .select()
      .from(customExercises)
      .where(eq(customExercises.userId, userId));
  }

  async upsertCustomExercise(
    data: InsertCustomExercise,
  ): Promise<CustomExercise> {
    const [result] = await db
      .insert(customExercises)
      .values(data)
      .onConflictDoUpdate({
        target: [customExercises.userId, customExercises.name],
        set: { category: data.category },
      })
      .returning();
    return result;
  }

  async updateLastWeeklySummaryAt(userId: string): Promise<void> {
    await db
      .update(users)
      .set({ lastWeeklySummaryAt: new Date() })
      .where(eq(users.id, userId));
  }

  async updateLastMissedReminderAt(userId: string): Promise<void> {
    await db
      .update(users)
      .set({ lastMissedReminderAt: new Date() })
      .where(eq(users.id, userId));
  }

  async getUsersWithEmailNotifications(): Promise<User[]> {
    return await db
      .select()
      .from(users)
      .where(and(eq(users.emailNotifications, 1), isNotNull(users.email)));
  }
}
