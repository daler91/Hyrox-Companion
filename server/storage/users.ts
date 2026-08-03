import { calculateMafHr } from "@shared/maf";
import {
  type ChatMessage,
  chatMessages,
  type CustomExercise,
  customExercises,
  foodLogEntries,
  foods,
  type GarminConnection,
  garminConnections,
  type InsertChatMessage,
  type InsertCustomExercise,
  type InsertGarminConnection,
  type InsertStravaConnection,
  mafProfile,
  rateLimitBuckets,
  recipeIngredients,
  recipes,
  type StravaConnection,
  stravaConnections,
  type UpdateUserPreferences,
  type UpsertUser,
  type User,
  users,
} from "@shared/schema";
import { and, desc, eq, inArray, isNotNull, isNull, lt, lte, notExists, or, sql } from "drizzle-orm";

import { decryptToken,encryptToken } from "../crypto";
import { db } from "../db";
import { logger } from "../logger";

function isUsersEmailUniqueViolation(error: unknown): boolean {
  const pgError = error as { code?: string; constraint?: string };
  return pgError.code === "23505" && pgError.constraint === "users_email_unique";
}

export class UserStorage {
  async getUsers(ids: string[]): Promise<User[]> {
    if (ids.length === 0) return [];
    return await db.select().from(users).where(inArray(users.id, ids));
  }

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  /**
   * Delete a user (FK cascades handle child rows) AND hard-delete their
   * PRIVATE custom foods in the same transaction (GDPR Art. 17).
   *
   * foods.created_by_user_id is `set null` on user delete — a deliberate FK
   * choice, since RESTRICT FKs from food_log_entries/recipes into foods would
   * otherwise block the user delete. But set-null alone strands the user's
   * private custom foods as ownerless rows, so this method erases them
   * explicitly. Ordering inside the transaction matters:
   *   1. Capture the private-custom food ids while created_by_user_id is
   *      still set (the cascade destroys the only ownership signal).
   *   2. Delete the user row — cascades remove the user's OWN rows
   *      referencing those foods (log entries, recipes, favorites, servings).
   *   3. Delete the captured foods that are now unreferenced. The delete is
   *      reference-guarded (notExists on every RESTRICT FK) because OTHER
   *      users may legitimately reference a food that was public when they
   *      logged it and was later re-privatized by its owner — an unguarded
   *      delete would hit the RESTRICT FK and abort the whole deletion AFTER
   *      the Clerk identity is gone, stranding erasure. Such foods survive as
   *      ownerless private rows: hidden from all search/resolution (visibleTo
   *      requires owner / non-custom source / is_public), while the
   *      referencing users' existing history keeps rendering (entry display
   *      joins foods directly — owning an entry is the right to see it).
   *      That retention matches the sharing disclosure: the food was
   *      published, someone relied on it.
   *
   * PUBLIC custom foods (is_public = true) intentionally survive with owner
   * set-null — sharing was an explicit opt-in, disclosed in the share UI, and
   * visibility rests on is_public rather than the owner column.
   *
   * Returns the ACTUALLY deleted food ids so the caller can purge their
   * embeddings from the separate vector DB (food_embeddings has no user
   * column). Surviving referenced foods keep working; their embeddings are
   * cache and get re-created by the backfill cron.
   */
  async deleteUserAndPrivateCustomFoods(
    id: string,
  ): Promise<{ deleted: boolean; deletedFoodIds: string[] }> {
    return await db.transaction(async (tx) => {
      const privateFoods = await tx
        .select({ id: foods.id })
        .from(foods)
        .where(
          and(eq(foods.createdByUserId, id), eq(foods.source, "custom"), eq(foods.isPublic, false)),
        );
      const foodIds = privateFoods.map((row) => row.id);

      const result = await tx.delete(users).where(eq(users.id, id));
      const deleted = result.rowCount !== null && result.rowCount > 0;
      if (!deleted) return { deleted: false, deletedFoodIds: [] };

      if (foodIds.length === 0) return { deleted: true, deletedFoodIds: [] };

      const deletedRows = await tx
        .delete(foods)
        .where(
          and(
            inArray(foods.id, foodIds),
            notExists(
              tx
                .select({ one: sql`1` })
                .from(foodLogEntries)
                .where(eq(foodLogEntries.foodId, foods.id)),
            ),
            notExists(
              tx
                .select({ one: sql`1` })
                .from(recipeIngredients)
                .where(eq(recipeIngredients.foodId, foods.id)),
            ),
            notExists(
              tx.select({ one: sql`1` }).from(recipes).where(eq(recipes.foodId, foods.id)),
            ),
          ),
        )
        .returning({ id: foods.id });
      return { deleted: true, deletedFoodIds: deletedRows.map((row) => row.id) };
    });
  }

  /**
   * Purge the user's rate-limit buckets on account deletion (S6). Their keys
   * are `${category}:user:${id}` (server/routeUtils.ts) and are NOT FK-linked
   * to `users`, so the deletion cascade can't reach them. `split_part` matches
   * the id after `:user:` exactly — avoiding LIKE-wildcard pitfalls when a
   * Clerk userId contains `_`.
   */
  async purgeRateLimitBucketsForUser(id: string): Promise<number> {
    const result = await db
      .delete(rateLimitBuckets)
      .where(sql`split_part(${rateLimitBuckets.key}, ':user:', 2) = ${id}`);
    return result.rowCount ?? 0;
  }

  private async upsertUserRow(userData: UpsertUser): Promise<User> {
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

  async upsertUser(userData: UpsertUser): Promise<User> {
    try {
      return await this.upsertUserRow(userData);
    } catch (error) {
      if (userData.email && isUsersEmailUniqueViolation(error)) {
        const { email: _email, ...userDataWithoutEmail } = userData;
        logger.warn(
          { err: error, userId: userData.id },
          "User email already exists; retrying user upsert without email",
        );
        return await this.upsertUserRow(userDataWithoutEmail);
      }
      throw error;
    }
  }

  async updateUserPreferences(
    userId: string,
    preferences: UpdateUserPreferences,
  ): Promise<User | undefined> {
    const before = await this.getUser(userId);
    const [user] = await db
      .update(users)
      .set({
        ...preferences,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();

    if (
      user?.trainingStyleId === "maf_method" &&
      user.mafAge != null &&
      user.mafConsistency != null &&
      user.mafTrend != null &&
      user.mafInjuryIllnessMedication != null
    ) {
      const maf = calculateMafHr({
        age: user.mafAge,
        injuryIllnessMedication: user.mafInjuryIllnessMedication,
        consistency: user.mafConsistency as "low" | "moderate" | "high",
        trend: user.mafTrend as "improving" | "flat" | "declining",
      });
      const reason = JSON.stringify({ reasonCodes: maf.reasonCodes, explanation: maf.explanation, warning: maf.warning });

      // S4: updateUserPreferences runs on every settings save, so snapshot the
      // MAF profile only when it actually changes — otherwise an unchanged
      // profile appends a duplicate maf_profile row on each save. baseHr +
      // adjustment + finalHr + reason together capture the input-derived result.
      const [latestSnapshot] = await db
        .select({
          baseHr: mafProfile.baseHr,
          adjustment: mafProfile.adjustment,
          finalHr: mafProfile.finalHr,
          reason: mafProfile.reason,
        })
        .from(mafProfile)
        .where(eq(mafProfile.userId, userId))
        .orderBy(desc(mafProfile.calculatedAt))
        .limit(1);

      const mafProfileUnchanged =
        latestSnapshot?.baseHr === maf.base &&
        latestSnapshot?.adjustment === maf.adjustment &&
        latestSnapshot?.finalHr === maf.ceiling &&
        latestSnapshot?.reason === reason;

      if (!mafProfileUnchanged) {
        await db.insert(mafProfile).values({
          userId,
          baseHr: maf.base,
          adjustment: maf.adjustment,
          finalHr: maf.ceiling,
          reason,
        });
        // Operational telemetry only — the derived HR values are Art. 9 health
        // data and are intentionally kept out of the log message (Bearer leak).
        logger.info({
          context: "health-metrics",
          event: "maf_hr_calculated",
          userId,
          trainingStyleId: user.trainingStyleId,
        }, "MAF HR calculated and persisted");
      }
    } else if (user?.trainingStyleId === "maf_method") {
      logger.warn({
        context: "health-alert",
        event: "missing_maf_hr_inputs",
        userId,
        hasAge: user.mafAge != null,
        hasConsistency: user.mafConsistency != null,
        hasTrend: user.mafTrend != null,
        hasInjuryIllnessMedication: user.mafInjuryIllnessMedication != null,
      }, "MAF style selected without full MAF HR inputs");
    }

    if (before && user) {
      const styleChanged = before.trainingStyleId !== user.trainingStyleId;
      const styleProvidedInPatch = Object.hasOwn(preferences, "trainingStyleId");
      if (styleChanged) {
        logger.info({
          context: "health-metrics",
          event: "training_style_changed",
          userId,
          previousStyleId: before.trainingStyleId,
          nextStyleId: user.trainingStyleId,
          changedAt: user.trainingStyleChangedAt?.toISOString() ?? null,
        }, "Training style changed");
      } else if (styleProvidedInPatch) {
        logger.info({
          context: "health-metrics",
          event: "training_style_selected",
          userId,
          styleId: user.trainingStyleId,
        }, "Training style selected");
      }
    }
    return user;
  }

  async updateIsAutoCoaching(userId: string, isAutoCoaching: boolean): Promise<void> {
    await db
      .update(users)
      .set({ isAutoCoaching, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  /**
   * Clears users stuck with isAutoCoaching=true. Called on server startup
   * (no threshold → wipes all stuck flags) and on an interval at runtime
   * (threshold → only flags whose updatedAt is older than the threshold,
   * so legitimate in-flight jobs are left alone — W5).
   */
  async resetStaleAutoCoaching(olderThanMs?: number): Promise<number> {
    const conditions = [eq(users.isAutoCoaching, true)];
    if (olderThanMs !== undefined) {
      const cutoff = new Date(Date.now() - olderThanMs);
      conditions.push(lt(users.updatedAt, cutoff));
    }
    const rows = await db
      .update(users)
      .set({ isAutoCoaching: false, updatedAt: new Date() })
      .where(conditions.length === 1 ? conditions[0] : and(...conditions))
      .returning({ id: users.id });
    return rows.length;
  }

  // Cursor-paginated chat history. Returns the newest `limit` messages
  // older than the (timestamp, id) cursor in chronological order so
  // callers can append to the existing conversation view without a sort.
  // Composite cursor is required because `chat_messages.timestamp` is not
  // unique — user+assistant pairs saved in the same handler can share a
  // millisecond. A timestamp-only `lt(...)` filter silently drops those
  // sibling rows, making them unreachable via pagination. The route layer
  // validates that `beforeTimestamp` and `beforeId` are always passed
  // together.
  async getChatMessages(
    userId: string,
    options: { limit?: number; beforeTimestamp?: Date; beforeId?: string } = {},
  ): Promise<ChatMessage[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const conditions = [eq(chatMessages.userId, userId)];
    if (options.beforeTimestamp && options.beforeId) {
      const cursorClause = or(
        lt(chatMessages.timestamp, options.beforeTimestamp),
        and(
          eq(chatMessages.timestamp, options.beforeTimestamp),
          lt(chatMessages.id, options.beforeId),
        ),
      );
      if (cursorClause) conditions.push(cursorClause);
    }
    const page = await db
      .select()
      .from(chatMessages)
      .where(conditions.length === 1 ? conditions[0] : and(...conditions))
      .orderBy(desc(chatMessages.timestamp), desc(chatMessages.id))
      .limit(limit);
    return page.reverse();
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

  // Used by the GDPR Art. 15 data export endpoint to dump every chat message
  // for the user in chronological order. Deliberately uncapped — the export
  // is a manual, rate-limited action (5/min), so the unbounded read is the
  // right trade-off vs. the paginated getChatMessages used by the UI.
  async getAllChatMessagesForExport(userId: string): Promise<ChatMessage[]> {
    return await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.userId, userId))
      .orderBy(chatMessages.timestamp, chatMessages.id);
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
          // A successful (re)connect always yields working credentials.
          requiresReauth: false,
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

  /**
   * Token-refresh path: updates ONLY the rotated token triple and clears the
   * reauth tombstone. Deliberately narrower than upsertStravaConnection so a
   * refresh can never clobber stravaAthleteId/scope/lastSyncedAt.
   */
  async updateStravaTokens(
    userId: string,
    tokens: { accessToken: string; refreshToken: string; expiresAt: Date },
  ): Promise<void> {
    await db
      .update(stravaConnections)
      .set({
        accessToken: encryptToken(tokens.accessToken),
        refreshToken: encryptToken(tokens.refreshToken),
        expiresAt: tokens.expiresAt,
        requiresReauth: false,
      })
      .where(eq(stravaConnections.userId, userId));
  }

  /**
   * Marks the connection as needing user re-authorization (Strava rejected
   * our refresh token or API credentials permanently). The row is kept so
   * the UI can offer "Reconnect" instead of showing "never connected".
   */
  async setStravaReauthRequired(userId: string): Promise<void> {
    await db
      .update(stravaConnections)
      .set({ requiresReauth: true })
      .where(eq(stravaConnections.userId, userId));
  }

  /**
   * @param syncedThrough Incremental-sync cursor: when a capped sync could
   * not fetch everything, this is the start_date of the newest activity that
   * WAS fetched, so the next sync resumes from there instead of skipping the
   * unfetched window. Defaults to "now" for a complete sync.
   */
  async updateStravaLastSync(userId: string, syncedThrough?: Date): Promise<void> {
    await db
      .update(stravaConnections)
      .set({ lastSyncedAt: syncedThrough ?? new Date() })
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
      encryptedEmail: connection.encryptedEmail ? decryptToken(connection.encryptedEmail) : null,
      encryptedPassword: connection.encryptedPassword ? decryptToken(connection.encryptedPassword) : null,
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
      encryptedEmail: connection.encryptedEmail ? decryptToken(connection.encryptedEmail) : null,
      encryptedPassword: connection.encryptedPassword ? decryptToken(connection.encryptedPassword) : null,
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
    // Clear every stored Garmin secret when a connection breaks. Layers 4 & 6
    // (server/garmin.ts) refuse to auto-retry once lastError is set, so the
    // email/password/tokens are dead weight until a manual reconnect re-collects
    // them — dropping them here avoids retaining replayable credentials for a
    // connection we will never reuse automatically (review M2). The non-secret
    // tombstone (display name, lastError, lastSyncedAt) is kept for the UI.
    await db
      .update(garminConnections)
      .set({
        lastError: error,
        encryptedEmail: null,
        encryptedPassword: null,
        encryptedOauth1Token: null,
        encryptedOauth2Token: null,
      })
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

  /**
   * Atomically claim the right to send this athlete their weekly summary.
   *
   * Stamps the ledger and reports whether THIS call won, in one statement, so
   * the decision and the record cannot come apart. The previous shape read the
   * timestamp, sent the email, and stamped afterwards — a check-then-act with
   * a multi-second window (analytics queries plus a Resend round trip) in the
   * middle, during which any other producer would also decide to send.
   *
   * `notBefore` is deliberately looser than the nominal cadence: because the
   * stamp now lands at claim time rather than after the send, comparing
   * against a full 7 days would make each week's tick fall a few seconds
   * inside the previous one's window and skip, which is exactly how a weekly
   * summary ended up arriving fortnightly. The caller's day-of-week gate is
   * what enforces "once a week"; this only has to stop a second send within
   * the same local day.
   */
  async claimWeeklySummary(userId: string, notBefore: Date, now = new Date()): Promise<boolean> {
    const claimed = await db
      .update(users)
      .set({ lastWeeklySummaryAt: now })
      .where(
        and(
          eq(users.id, userId),
          or(isNull(users.lastWeeklySummaryAt), lt(users.lastWeeklySummaryAt, notBefore)),
        ),
      )
      .returning({ id: users.id });
    return claimed.length > 0;
  }

  /** Missed-workout counterpart of {@link claimWeeklySummary}. */
  async claimMissedReminder(userId: string, notBefore: Date, now = new Date()): Promise<boolean> {
    const claimed = await db
      .update(users)
      .set({ lastMissedReminderAt: now })
      .where(
        and(
          eq(users.id, userId),
          or(isNull(users.lastMissedReminderAt), lt(users.lastMissedReminderAt, notBefore)),
        ),
      )
      .returning({ id: users.id });
    return claimed.length > 0;
  }

  /** Post-workout refuel-push counterpart of {@link claimWeeklySummary}. */
  async claimRefuelReminder(userId: string, notBefore: Date, now = new Date()): Promise<boolean> {
    const claimed = await db
      .update(users)
      .set({ lastRefuelReminderAt: now })
      .where(
        and(
          eq(users.id, userId),
          or(isNull(users.lastRefuelReminderAt), lt(users.lastRefuelReminderAt, notBefore)),
        ),
      )
      .returning({ id: users.id });
    return claimed.length > 0;
  }

  /** Evening logging-push counterpart of {@link claimWeeklySummary}. */
  async claimLoggingReminder(userId: string, notBefore: Date, now = new Date()): Promise<boolean> {
    const claimed = await db
      .update(users)
      .set({ lastLoggingReminderAt: now })
      .where(
        and(
          eq(users.id, userId),
          or(isNull(users.lastLoggingReminderAt), lt(users.lastLoggingReminderAt, notBefore)),
        ),
      )
      .returning({ id: users.id });
    return claimed.length > 0;
  }

  /** Users who opted into at least one nutrition push reminder. */
  async getUsersWithNutritionPushReminders(): Promise<User[]> {
    return await db
      .select()
      .from(users)
      .where(or(eq(users.pushRefuelReminder, true), eq(users.pushLoggingReminder, true)));
  }

  async getUsersWithEmailNotifications(): Promise<User[]> {
    return await db
      .select()
      .from(users)
      .where(and(eq(users.emailNotifications, true), isNotNull(users.email)));
  }

  /** Users whose one-time baseline MAF test reminder is due (still on MAF). */
  async getUsersWithDueMafBaselineTest(now: Date): Promise<User[]> {
    return await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.trainingStyleId, "maf_method"),
          isNotNull(users.mafBaselineTestScheduledAt),
          lte(users.mafBaselineTestScheduledAt, now),
        ),
      );
  }

  /**
   * Atomically claim a due baseline-test reminder: clears the schedule only if
   * it is still set and due, and reports whether THIS call won the claim. Lets
   * concurrent/duplicate reminder jobs avoid double-sending (Codex P2) — only
   * the job whose conditional UPDATE affects a row sees `true`.
   */
  async claimMafBaselineTest(userId: string, now: Date): Promise<boolean> {
    const claimed = await db
      .update(users)
      .set({ mafBaselineTestScheduledAt: null })
      .where(
        and(
          eq(users.id, userId),
          isNotNull(users.mafBaselineTestScheduledAt),
          lte(users.mafBaselineTestScheduledAt, now),
        ),
      )
      .returning({ id: users.id });
    return claimed.length > 0;
  }
}
