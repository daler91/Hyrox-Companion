import { pushSubscriptions, users } from "@shared/schema";
import { and, eq } from "drizzle-orm";

import { db } from "../db";

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

  /**
   * Fetch all user IDs that have at least one push subscription
   * and have email notifications enabled (reusing the same opt-in flag).
   */
  async getUsersWithPushSubscriptions(): Promise<string[]> {
    const rows = await db
      .selectDistinct({ userId: pushSubscriptions.userId })
      .from(pushSubscriptions)
      .innerJoin(users, eq(users.id, pushSubscriptions.userId))
      .where(eq(users.emailNotifications, true));
    return rows.map((r) => r.userId);
  }
}
