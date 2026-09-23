import { pushSubscriptions } from "@shared/schema";
import { and, asc, count, eq, inArray } from "drizzle-orm";

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

export class PushStorage {
  async saveSubscription(
    userId: string,
    subscription: { endpoint: string; p256dh: string; auth: string },
  ): Promise<void> {
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
    return db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
  }
}
