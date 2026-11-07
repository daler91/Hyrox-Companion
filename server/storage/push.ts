import { type DevicePlatform, devicePushTokens, pushSubscriptions } from "@shared/schema";
import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";

import { db } from "../db";

/**
 * Most devices an athlete can register for push at once.
 *
 * Each row is an arbitrary HTTPS URL the server will later POST to, so an
 * unbounded list turns POST /api/v1/push/test into a way to make the server
 * fan out requests to many third-party hosts. Ten covers a realistic
 * phone/tablet/laptop/browser spread with room to spare; beyond that the
 * oldest rows are evicted rather than the new registration refused, so a user
 * replacing devices is never locked out of notifications.
 */
export const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 10;

/**
 * Most native app installs an athlete can register for push at once. The same
 * reasoning and the same number as MAX_PUSH_SUBSCRIPTIONS_PER_USER: a phone,
 * a tablet and a few reinstalls fit, and past it the least recently seen
 * install is evicted rather than the new one refused.
 */
export const MAX_DEVICE_PUSH_TOKENS_PER_USER = 10;

export class PushStorage {
  async saveSubscription(
    userId: string,
    subscription: { endpoint: string; p256dh: string; auth: string },
  ): Promise<void> {
    // An endpoint identifies a browser, not an athlete. When a second athlete
    // subscribes on a shared device, the endpoint moves to them: keeping the
    // previous owner's row (the old (user_id, endpoint) upsert did) sent both
    // athletes' notifications to that one screen. Deleted before the insert so
    // a failure in between leaves the device subscribed to nobody, never to
    // both. P3 (CODEBASE_ANALYSIS_2026-10-03)
    await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.endpoint, subscription.endpoint),
          ne(pushSubscriptions.userId, userId),
        ),
      );
    await db
      .insert(pushSubscriptions)
      .values({ userId, ...subscription })
      .onConflictDoUpdate({
        target: [pushSubscriptions.userId, pushSubscriptions.endpoint],
        set: { p256dh: subscription.p256dh, auth: subscription.auth },
      });
    await this.evictOldestBeyondLimit(userId);
  }

  /**
   * Keep only the newest MAX_PUSH_SUBSCRIPTIONS_PER_USER rows for a user.
   * Runs after every insert; a no-op in the overwhelmingly common case where
   * the athlete is under the limit.
   */
  private async evictOldestBeyondLimit(userId: string): Promise<void> {
    const [row] = await db
      .select({ total: count() })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
    const total = Number(row?.total ?? 0);
    if (total <= MAX_PUSH_SUBSCRIPTIONS_PER_USER) return;

    const stale = await db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .orderBy(asc(pushSubscriptions.createdAt))
      .limit(total - MAX_PUSH_SUBSCRIPTIONS_PER_USER);
    if (stale.length === 0) return;

    await db.delete(pushSubscriptions).where(
      and(
        eq(pushSubscriptions.userId, userId),
        inArray(
          pushSubscriptions.id,
          stale.map((s) => s.id),
        ),
      ),
    );
  }

  async removeSubscription(userId: string, endpoint: string): Promise<boolean> {
    const result = await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.userId, userId),
          eq(pushSubscriptions.endpoint, endpoint),
        ),
      );
    return (result.rowCount ?? 0) > 0;
  }

  async removeById(id: string): Promise<void> {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
  }

  async getSubscriptionsForUser(
    userId: string,
  ): Promise<Array<{ id: string; endpoint: string; p256dh: string; auth: string }>> {
    return await db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
  }

  /**
   * Register (or refresh) a native app install's FCM token for this athlete.
   *
   * The token is unique on its own, so the upsert moves an existing row to the
   * athlete now registering it: when someone else signs in on a shared phone,
   * notifications follow them, and the previous owner stops getting
   * notifications on a phone they are no longer signed in to.
   */
  async saveDeviceToken(
    userId: string,
    device: { token: string; platform: DevicePlatform; appVersion: string | null },
  ): Promise<void> {
    await db
      .insert(devicePushTokens)
      .values({ userId, ...device })
      .onConflictDoUpdate({
        target: devicePushTokens.token,
        set: { userId, platform: device.platform, appVersion: device.appVersion, lastSeenAt: sql`now()` },
      });
    await this.evictLeastRecentDeviceTokensBeyondLimit(userId);
  }

  /** Keep only the MAX_DEVICE_PUSH_TOKENS_PER_USER most recently seen installs. */
  private async evictLeastRecentDeviceTokensBeyondLimit(userId: string): Promise<void> {
    const [row] = await db
      .select({ total: count() })
      .from(devicePushTokens)
      .where(eq(devicePushTokens.userId, userId));
    const total = Number(row?.total ?? 0);
    if (total <= MAX_DEVICE_PUSH_TOKENS_PER_USER) return;

    const stale = await db
      .select({ id: devicePushTokens.id })
      .from(devicePushTokens)
      .where(eq(devicePushTokens.userId, userId))
      .orderBy(asc(devicePushTokens.lastSeenAt))
      .limit(total - MAX_DEVICE_PUSH_TOKENS_PER_USER);
    if (stale.length === 0) return;

    await db.delete(devicePushTokens).where(
      and(
        eq(devicePushTokens.userId, userId),
        inArray(
          devicePushTokens.id,
          stale.map((s) => s.id),
        ),
      ),
    );
  }

  /** Unregister one install, for sign-out. Scoped to the athlete so nobody can unregister another's device. */
  async removeDeviceToken(userId: string, token: string): Promise<boolean> {
    const result = await db
      .delete(devicePushTokens)
      .where(and(eq(devicePushTokens.userId, userId), eq(devicePushTokens.token, token)));
    return (result.rowCount ?? 0) > 0;
  }

  /** Prune a token FCM reported as no longer valid. */
  async removeDeviceTokenById(id: string): Promise<void> {
    await db.delete(devicePushTokens).where(eq(devicePushTokens.id, id));
  }

  async getDeviceTokensForUser(
    userId: string,
  ): Promise<Array<{ id: string; platform: string; token: string }>> {
    return await db
      .select({ id: devicePushTokens.id, platform: devicePushTokens.platform, token: devicePushTokens.token })
      .from(devicePushTokens)
      .where(eq(devicePushTokens.userId, userId));
  }

  /** Every install registered to the athlete, for the GDPR export. */
  async listDeviceTokensForExport(
    userId: string,
  ): Promise<Array<{ platform: string; token: string; appVersion: string | null; createdAt: Date; lastSeenAt: Date }>> {
    return await db
      .select({
        platform: devicePushTokens.platform,
        token: devicePushTokens.token,
        appVersion: devicePushTokens.appVersion,
        createdAt: devicePushTokens.createdAt,
        lastSeenAt: devicePushTokens.lastSeenAt,
      })
      .from(devicePushTokens)
      .where(eq(devicePushTokens.userId, userId));
  }
}
