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
import { db } from "../db";
import { eq, and, isNotNull, sql } from "drizzle-orm";

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

  async updateUserPreferences(userId: string, preferences: UpdateUserPreferences): Promise<User | undefined> {
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
    await db
      .delete(chatMessages)
      .where(eq(chatMessages.userId, userId));
    return true;
  }

  async getStravaConnection(userId: string): Promise<StravaConnection | undefined> {
    const [connection] = await db
      .select()
      .from(stravaConnections)
      .where(eq(stravaConnections.userId, userId));
    return connection;
  }

  async upsertStravaConnection(data: InsertStravaConnection): Promise<StravaConnection> {
    const [connection] = await db
      .insert(stravaConnections)
      .values(data)
      .onConflictDoUpdate({
        target: stravaConnections.userId,
        set: {
          stravaAthleteId: data.stravaAthleteId,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          expiresAt: data.expiresAt,
          scope: data.scope,
        },
      })
      .returning();
    return connection;
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

  async upsertCustomExercise(data: InsertCustomExercise): Promise<CustomExercise> {
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

  async upsertCustomExercises(data: InsertCustomExercise[]): Promise<CustomExercise[]> {
    if (data.length === 0) return [];

    // Deduplicate in-memory by name and userId to avoid PostgreSQL error:
    // "ON CONFLICT DO UPDATE command cannot affect row a second time"
    const uniqueData = Array.from(
      data.reduce((map, item) => {
        const key = `${item.userId}:${item.name}`;
        if (!map.has(key)) {
          map.set(key, item);
        }
        return map;
      }, new Map<string, InsertCustomExercise>()).values()
    );

    return await db
      .insert(customExercises)
      .values(uniqueData)
      .onConflictDoUpdate({
        target: [customExercises.userId, customExercises.name],
        set: { category: sql`EXCLUDED.category` },
      })
      .returning();
  }

  async updateLastWeeklySummaryAt(userId: string): Promise<void> {
    await db.update(users).set({ lastWeeklySummaryAt: new Date() }).where(eq(users.id, userId));
  }

  async updateLastMissedReminderAt(userId: string): Promise<void> {
    await db.update(users).set({ lastMissedReminderAt: new Date() }).where(eq(users.id, userId));
  }

  async getUsersWithEmailNotifications(): Promise<User[]> {
    return await db.select().from(users).where(
      and(
        eq(users.emailNotifications, 1),
        isNotNull(users.email)
      )
    );
  }
}
