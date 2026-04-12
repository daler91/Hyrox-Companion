import {
  type ChatMessage,
  chatMessages,
  type CustomExercise,
  customExercises,
  type GarminConnection,
  garminConnections,
  type InsertChatMessage,
  type InsertCustomExercise,
  type InsertGarminConnection,
  type InsertStravaConnection,
  type StravaConnection,
  stravaConnections,
  type UpdateUserPreferences,
  type UpsertUser,
  type User,
  users,
} from "@shared/schema";
import { and, eq, isNotNull } from "drizzle-orm";

import { decryptToken,encryptToken } from "../crypto";
import { db } from "../db";

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

  async updateIsAutoCoaching(userId: string, isAutoCoaching: boolean): Promise<void> {
    await db
      .update(users)
      .set({ isAutoCoaching, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  /**
   * Clears any users stuck with isAutoCoaching=true. Invoked on server startup
   * as a safety net for flags orphaned by a crashed worker, an unhandled error
   * in triggerAutoCoach, or a pg-boss singleton-coalesced enqueue that dropped
   * the job. Returns the number of rows reset.
   */
  async resetStaleAutoCoaching(): Promise<number> {
    const rows = await db
      .update(users)
      .set({ isAutoCoaching: false, updatedAt: new Date() })
      .where(eq(users.isAutoCoaching, true))
      .returning({ id: users.id });
    return rows.length;
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

  // ---------------------------------------------------------------------------
  // Garmin Connect — credential-based session storage.
  //
  // Unlike Strava (which uses OAuth), Garmin requires us to store the user's
  // email + password so we can re-login when the cached OAuth1/OAuth2 tokens
  // expire (~1 year). All four secrets are encrypted at rest with the same
  // AES-256-GCM helper used for Strava tokens (server/crypto.ts).
  //
  // Token JSON blobs are stringified before encryption and parsed after
  // decryption — the storage layer is responsible for this so the routes
  // module never sees the wire format.
  // ---------------------------------------------------------------------------

  async getGarminConnection(
    userId: string,
  ): Promise<GarminConnection | undefined> {
    const [connection] = await db
      .select()
      .from(garminConnections)
      .where(eq(garminConnections.userId, userId));

    if (!connection) return connection;

    return {
      ...connection,
      encryptedEmail: decryptToken(connection.encryptedEmail),
      encryptedPassword: decryptToken(connection.encryptedPassword),
      encryptedOauth1Token: connection.encryptedOauth1Token
        ? decryptToken(connection.encryptedOauth1Token)
        : null,
      encryptedOauth2Token: connection.encryptedOauth2Token
        ? decryptToken(connection.encryptedOauth2Token)
        : null,
    };
  }

  async upsertGarminConnection(
    data: InsertGarminConnection,
  ): Promise<GarminConnection> {
    const encryptedData = {
      ...data,
      encryptedEmail: encryptToken(data.encryptedEmail),
      encryptedPassword: encryptToken(data.encryptedPassword),
      encryptedOauth1Token: data.encryptedOauth1Token
        ? encryptToken(data.encryptedOauth1Token)
        : null,
      encryptedOauth2Token: data.encryptedOauth2Token
        ? encryptToken(data.encryptedOauth2Token)
        : null,
    };

    const [connection] = await db
      .insert(garminConnections)
      .values(encryptedData)
      .onConflictDoUpdate({
        target: garminConnections.userId,
        set: {
          garminDisplayName: encryptedData.garminDisplayName,
          encryptedEmail: encryptedData.encryptedEmail,
          encryptedPassword: encryptedData.encryptedPassword,
          encryptedOauth1Token: encryptedData.encryptedOauth1Token,
          encryptedOauth2Token: encryptedData.encryptedOauth2Token,
          tokenExpiresAt: encryptedData.tokenExpiresAt,
          lastError: encryptedData.lastError,
        },
      })
      .returning();

    return {
      ...connection,
      encryptedEmail: decryptToken(connection.encryptedEmail),
      encryptedPassword: decryptToken(connection.encryptedPassword),
      encryptedOauth1Token: connection.encryptedOauth1Token
        ? decryptToken(connection.encryptedOauth1Token)
        : null,
      encryptedOauth2Token: connection.encryptedOauth2Token
        ? decryptToken(connection.encryptedOauth2Token)
        : null,
    };
  }

  /**
   * Updates only the cached OAuth tokens after a successful login or refresh.
   * Skips touching the email/password ciphertexts so we don't re-encrypt them
   * (which would generate new IVs and waste DB churn).
   */
  async updateGarminTokens(
    userId: string,
    oauth1Json: string,
    oauth2Json: string,
    tokenExpiresAt: Date | null,
  ): Promise<void> {
    await db
      .update(garminConnections)
      .set({
        encryptedOauth1Token: encryptToken(oauth1Json),
        encryptedOauth2Token: encryptToken(oauth2Json),
        tokenExpiresAt,
        lastError: null,
      })
      .where(eq(garminConnections.userId, userId));
  }

  async deleteGarminConnection(userId: string): Promise<boolean> {
    const result = await db
      .delete(garminConnections)
      .where(eq(garminConnections.userId, userId));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async updateGarminLastSync(userId: string): Promise<void> {
    await db
      .update(garminConnections)
      .set({ lastSyncedAt: new Date(), lastError: null })
      .where(eq(garminConnections.userId, userId));
  }

  /**
   * Persists a friendly error message so the UI can show "Reconnect to Garmin"
   * without exposing internals. Called from the routes module on auth failure.
   */
  async setGarminError(userId: string, error: string): Promise<void> {
    await db
      .update(garminConnections)
      .set({ lastError: error })
      .where(eq(garminConnections.userId, userId));
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
      .where(and(eq(users.emailNotifications, true), isNotNull(users.email)));
  }
}
