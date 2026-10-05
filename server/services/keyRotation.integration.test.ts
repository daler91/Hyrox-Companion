import { garminConnections, stravaConnections, users } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "../db";
import { seedUser } from "../storage/__tests__/integrationDb";
import { reencryptStoredCredentials } from "./keyRotation";

/**
 * D42 (CODEBASE_ANALYSIS_2026-10-03), against real Postgres: the key-rotation
 * sweep re-encrypts from a snapshot, and the request-path writers (a Strava
 * token refresh, a Garmin auth failure clearing the login, a first Garmin
 * login storing its tokens) are not fenced by its advisory lock. A write that
 * lands between the sweep's read and its UPDATE must survive.
 *
 * The real crypto is covered by keyRotation.test.ts; here a stand-in rotation
 * maps "rot-old:" values to "rot-new:" so the suite is about the SQL, and
 * leaves any other connection row in the shared test database alone.
 */

const { beforeRow } = vi.hoisted(() => ({
  // Runs between the sweep's snapshot read and its UPDATE, keyed by row id.
  beforeRow: new Map<string, () => Promise<unknown>>(),
}));

vi.mock("../crypto", () => ({
  currentKeyVersion: () => 2,
  reencryptToken: (value: string) =>
    value.startsWith("rot-old:") ? value.replace("rot-old:", "rot-new:") : value,
}));

vi.mock("@shared/inSequence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@shared/inSequence")>();
  return {
    ...actual,
    inSequence: <T extends { id: string }, R>(
      items: readonly T[],
      step: (item: T, index: number) => Promise<R>,
    ) =>
      actual.inSequence(items, async (item, index) => {
        await beforeRow.get(item.id)?.();
        return await step(item, index);
      }),
  };
});

const ATHLETES = ["kr-strava-rotated", "kr-strava-idle", "kr-garmin-cleared", "kr-garmin-login"];

async function removeAthletes(): Promise<void> {
  // Connections cascade with the user row.
  await db.delete(users).where(inArray(users.id, ATHLETES));
}

describe("reencryptStoredCredentials compare-and-swap (real Postgres)", () => {
  beforeEach(async () => {
    beforeRow.clear();
    await removeAthletes();
    for (const id of ATHLETES) await seedUser(id);
  });

  afterAll(async () => {
    await removeAthletes();
  });

  it("never reverts or re-stores a credential rewritten mid-sweep, and still migrates the rest", async () => {
    const expiresAt = new Date("2026-11-01T00:00:00Z");
    await db.insert(stravaConnections).values([
      {
        id: "kr-s-rotated",
        userId: "kr-strava-rotated",
        stravaAthleteId: "1",
        accessToken: "rot-old:access-1",
        refreshToken: "rot-old:refresh-1",
        expiresAt,
      },
      {
        id: "kr-s-idle",
        userId: "kr-strava-idle",
        stravaAthleteId: "2",
        accessToken: "rot-old:access-2",
        refreshToken: "rot-old:refresh-2",
        expiresAt,
      },
    ]);
    await db.insert(garminConnections).values([
      {
        id: "kr-g-cleared",
        userId: "kr-garmin-cleared",
        encryptedEmail: "rot-old:email-3",
        encryptedPassword: "rot-old:password-3",
        encryptedOauth2Token: "rot-old:oauth2-3",
      },
      {
        id: "kr-g-login",
        userId: "kr-garmin-login",
        encryptedEmail: "rot-old:email-4",
        encryptedPassword: "rot-old:password-4",
      },
    ]);

    // A Strava refresh rotates both tokens, already under the active key.
    beforeRow.set("kr-s-rotated", () =>
      db
        .update(stravaConnections)
        .set({ accessToken: "rot-new:fresh-access", refreshToken: "rot-new:fresh-refresh" })
        .where(eq(stravaConnections.id, "kr-s-rotated")),
    );
    // A Garmin auth failure clears the replayable login (review M2).
    beforeRow.set("kr-g-cleared", () =>
      db
        .update(garminConnections)
        .set({ encryptedEmail: null, encryptedPassword: null, lastError: "auth failed" })
        .where(eq(garminConnections.id, "kr-g-cleared")),
    );
    // A first login stores the OAuth tokens the snapshot read as null.
    beforeRow.set("kr-g-login", () =>
      db
        .update(garminConnections)
        .set({ encryptedOauth1Token: "rot-new:oauth1-4", encryptedOauth2Token: "rot-new:oauth2-4" })
        .where(eq(garminConnections.id, "kr-g-login")),
    );

    const summary = await reencryptStoredCredentials();

    expect(summary).toEqual({
      stravaUpdated: 1,
      garminUpdated: 0,
      failed: 0,
      changedDuringSweep: 3,
    });

    const strava = await db
      .select({
        id: stravaConnections.id,
        accessToken: stravaConnections.accessToken,
        refreshToken: stravaConnections.refreshToken,
      })
      .from(stravaConnections)
      .where(inArray(stravaConnections.id, ["kr-s-rotated", "kr-s-idle"]))
      .orderBy(stravaConnections.id);
    expect(strava).toEqual([
      { id: "kr-s-idle", accessToken: "rot-new:access-2", refreshToken: "rot-new:refresh-2" },
      {
        id: "kr-s-rotated",
        accessToken: "rot-new:fresh-access",
        refreshToken: "rot-new:fresh-refresh",
      },
    ]);

    const garmin = await db
      .select({
        id: garminConnections.id,
        encryptedEmail: garminConnections.encryptedEmail,
        encryptedPassword: garminConnections.encryptedPassword,
        encryptedOauth1Token: garminConnections.encryptedOauth1Token,
        encryptedOauth2Token: garminConnections.encryptedOauth2Token,
      })
      .from(garminConnections)
      .where(inArray(garminConnections.id, ["kr-g-cleared", "kr-g-login"]))
      .orderBy(garminConnections.id);
    expect(garmin).toEqual([
      // Cleared stays cleared: the old login is not re-stored.
      {
        id: "kr-g-cleared",
        encryptedEmail: null,
        encryptedPassword: null,
        encryptedOauth1Token: null,
        encryptedOauth2Token: "rot-old:oauth2-3",
      },
      // The tokens stored mid-sweep are kept, not overwritten with the snapshot's nulls.
      {
        id: "kr-g-login",
        encryptedEmail: "rot-old:email-4",
        encryptedPassword: "rot-old:password-4",
        encryptedOauth1Token: "rot-new:oauth1-4",
        encryptedOauth2Token: "rot-new:oauth2-4",
      },
    ]);
  });

  it("is resumable: a re-run migrates what a lost compare-and-swap left on the old version", async () => {
    await db.insert(garminConnections).values({
      id: "kr-g-login",
      userId: "kr-garmin-login",
      encryptedEmail: "rot-old:email-4",
      encryptedPassword: "rot-old:password-4",
    });
    beforeRow.set("kr-g-login", () =>
      db
        .update(garminConnections)
        .set({ encryptedOauth1Token: "rot-new:oauth1-4" })
        .where(eq(garminConnections.id, "kr-g-login")),
    );
    const first = await reencryptStoredCredentials();
    expect(first).toMatchObject({ garminUpdated: 0, changedDuringSweep: 1 });

    beforeRow.clear();
    const second = await reencryptStoredCredentials();

    expect(second).toMatchObject({ garminUpdated: 1, changedDuringSweep: 0 });
    const [row] = await db
      .select({
        encryptedEmail: garminConnections.encryptedEmail,
        encryptedOauth1Token: garminConnections.encryptedOauth1Token,
      })
      .from(garminConnections)
      .where(eq(garminConnections.id, "kr-g-login"));
    expect(row).toEqual({
      encryptedEmail: "rot-new:email-4",
      encryptedOauth1Token: "rot-new:oauth1-4",
    });
  });
});
