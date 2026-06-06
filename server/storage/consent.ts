import { type ConsentType, userConsents } from "@shared/schema";
import { desc, eq } from "drizzle-orm";

import { db } from "../db";

export class ConsentStorage {
  /**
   * Record (or update) a user's consent decision. One row per
   * (userId, consentType) holds the latest decision and when it was made
   * (W4 — auditable server-side consent, GDPR Art. 7).
   */
  async recordConsent(userId: string, consentType: ConsentType, granted: boolean): Promise<void> {
    await db
      .insert(userConsents)
      .values({ userId, consentType, granted })
      .onConflictDoUpdate({
        target: [userConsents.userId, userConsents.consentType],
        set: { granted, consentedAt: new Date(), updatedAt: new Date() },
      });
  }

  /** All recorded consent decisions for a user (latest per type, newest first). */
  async getConsents(
    userId: string,
  ): Promise<Array<{ consentType: string; granted: boolean; consentedAt: Date }>> {
    return db
      .select({
        consentType: userConsents.consentType,
        granted: userConsents.granted,
        consentedAt: userConsents.consentedAt,
      })
      .from(userConsents)
      .where(eq(userConsents.userId, userId))
      .orderBy(desc(userConsents.consentedAt));
  }
}
