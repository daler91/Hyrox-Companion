import { stravaConnections, users } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db";
import { storage } from "../index";
import { STALE_AUTO_COACHING_THRESHOLD_MS } from "../users";
import { resetIntegrationDb, seedUser } from "./integrationDb";

const NOW = new Date("2026-09-06T12:00:00Z");

/** An athlete opted into every background job: email, nutrition push, a due MAF test and Strava sync. */
async function seedBackgroundAthlete(
  id: string,
  overrides: Partial<typeof users.$inferInsert> = {},
): Promise<void> {
  await seedUser(id);
  await db
    .update(users)
    .set({
      emailNotifications: true,
      pushRefuelReminder: true,
      pushLoggingReminder: true,
      trainingStyleId: "maf_method",
      mafBaselineTestScheduledAt: new Date(NOW.getTime() - 60_000),
      ...overrides,
    })
    .where(eq(users.id, id));
  await db.insert(stravaConnections).values({
    userId: id,
    stravaAthleteId: `strava-${id}`,
    accessToken: "access",
    refreshToken: "refresh",
    expiresAt: new Date(NOW.getTime() + 3_600_000),
  });
}

// P17 (CODEBASE_ANALYSIS_2026-10-03): a stranded erasure's athlete has no
// Clerk identity left, so the background jobs must stop reaching them.
describe("background audiences skip accounts mid-erasure (real Postgres)", () => {
  const ACTIVE = "audience-active";
  const ERASING = "audience-erasing";

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedBackgroundAthlete(ACTIVE);
    await seedBackgroundAthlete(ERASING, {
      erasureRequestedAt: new Date(NOW.getTime() - 30 * 60_000),
    });
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  it("leaves them out of the email notification scan", async () => {
    const audience = await storage.users.getUsersWithEmailNotifications();

    expect(audience.map((user) => user.id)).toEqual([ACTIVE]);
  });

  it("leaves them out of the nutrition push reminder scan", async () => {
    const audience = await storage.users.getUsersWithNutritionPushReminders();

    expect(audience.map((user) => user.id)).toEqual([ACTIVE]);
  });

  it("leaves them out of the due MAF baseline reminder scan", async () => {
    const audience = await storage.users.getUsersWithDueMafBaselineTest(NOW);

    expect(audience.map((user) => user.id)).toEqual([ACTIVE]);
  });

  it("leaves their Strava connection out of the auto-sync scan", async () => {
    const due = await storage.users.listStravaConnectionsDueForSync(NOW, 10);

    expect(due.map((connection) => connection.userId)).toEqual([ACTIVE]);
  });

  it("leaves their Strava connection out of the webhook's owner lookup", async () => {
    expect(await storage.users.listStravaConnectionUsersByAthleteId(`strava-${ERASING}`)).toEqual(
      [],
    );
    expect(await storage.users.listStravaConnectionUsersByAthleteId(`strava-${ACTIVE}`)).toEqual([
      { userId: ACTIVE, requiresReauth: false },
    ]);

    // The same Strava athlete connected to both accounts: only the active
    // one may receive a webhook-driven sync.
    await db
      .update(stravaConnections)
      .set({ stravaAthleteId: "strava-shared" })
      .where(inArray(stravaConnections.userId, [ACTIVE, ERASING]));

    expect(await storage.users.listStravaConnectionUsersByAthleteId("strava-shared")).toEqual([
      { userId: ACTIVE, requiresReauth: false },
    ]);
  });
});

// D52 (CODEBASE_ANALYSIS_2026-10-03): the boot-time reset used to pass no
// threshold and clear every flag, including another replica's live run.
describe("UserStorage.resetStaleAutoCoaching (real Postgres)", () => {
  const LIVE = "autocoach-live";
  const ORPHANED = "autocoach-orphaned";

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(LIVE);
    await seedUser(ORPHANED);
    await db
      .update(users)
      .set({ isAutoCoaching: true, updatedAt: new Date() })
      .where(eq(users.id, LIVE));
    await db
      .update(users)
      .set({
        isAutoCoaching: true,
        updatedAt: new Date(Date.now() - STALE_AUTO_COACHING_THRESHOLD_MS - 60_000),
      })
      .where(eq(users.id, ORPHANED));
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  it("clears only the flags older than the threshold", async () => {
    const reset = await storage.users.resetStaleAutoCoaching(STALE_AUTO_COACHING_THRESHOLD_MS);

    expect(reset).toBe(1);
    const flags = new Map(
      (await db.select({ id: users.id, on: users.isAutoCoaching }).from(users)).map((row) => [
        row.id,
        row.on,
      ]),
    );
    expect(flags.get(LIVE)).toBe(true);
    expect(flags.get(ORPHANED)).toBe(false);
  });
});
