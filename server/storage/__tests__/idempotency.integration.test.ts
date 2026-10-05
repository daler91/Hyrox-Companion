import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db";
import { storage } from "../index";
import { seedUser } from "./integrationDb";

/**
 * The idempotency claim against the REAL schema: the claim token that fences
 * complete() and release() to the request that still owns the key. The
 * middleware tests mock all of this. Seeds and removes only its own user, so
 * it leaves other suites' rows in the shared database alone.
 */
describe("idempotency claims (real Postgres)", () => {
  const USER = "idempotency-fence-user";
  const META = { method: "POST", path: "/api/v1/workouts" };
  const DAY_SECONDS = 24 * 60 * 60;

  async function removeUser(): Promise<void> {
    await db.delete(users).where(eq(users.id, USER));
  }

  async function claimToken(key: string, ttlSeconds: number): Promise<string> {
    const outcome = await storage.idempotency.claim(USER, key, META, ttlSeconds);
    if (outcome.outcome !== "claimed")
      throw new Error(`expected to claim ${key}, got ${outcome.outcome}`);
    return outcome.claimToken;
  }

  beforeEach(async () => {
    await removeUser();
    await seedUser(USER);
  });

  afterAll(async () => {
    await removeUser();
  });

  it("caches the owner's response and replays it", async () => {
    const token = await claimToken("k-complete", 60);

    expect(await storage.idempotency.claim(USER, "k-complete", META, 60)).toEqual({
      outcome: "in_progress",
    });
    expect(
      await storage.idempotency.complete(
        USER,
        "k-complete",
        token,
        { statusCode: 201, responseBody: { id: "w-1" } },
        DAY_SECONDS,
      ),
    ).toBe(true);
    expect(await storage.idempotency.claim(USER, "k-complete", META, 60)).toEqual({
      outcome: "completed",
      statusCode: 201,
      responseBody: { id: "w-1" },
    });
  });

  it("lets the owner release its claim so the key can be retried", async () => {
    const token = await claimToken("k-release", 60);

    await storage.idempotency.release(USER, "k-release", token);

    expect((await storage.idempotency.claim(USER, "k-release", META, 60)).outcome).toBe("claimed");
  });

  // D8 (CODEBASE_ANALYSIS_2026-10-03): complete()/release() matched user and
  // key only, so a request whose claim had lapsed acted on the new owner's.
  it("ignores a stale request's release and complete once its claim was taken over", async () => {
    const stale = await claimToken("k-takeover", 0); // lapses at once
    const owner = await claimToken("k-takeover", 60);
    expect(owner).not.toBe(stale);

    await storage.idempotency.release(USER, "k-takeover", stale);
    expect(await storage.idempotency.claim(USER, "k-takeover", META, 60)).toEqual({
      outcome: "in_progress",
    });

    expect(
      await storage.idempotency.complete(
        USER,
        "k-takeover",
        stale,
        { statusCode: 201, responseBody: { id: "stale" } },
        DAY_SECONDS,
      ),
    ).toBe(false);
    expect(await storage.idempotency.claim(USER, "k-takeover", META, 60)).toEqual({
      outcome: "in_progress",
    });

    expect(
      await storage.idempotency.complete(
        USER,
        "k-takeover",
        owner,
        { statusCode: 201, responseBody: { id: "owner" } },
        DAY_SECONDS,
      ),
    ).toBe(true);
    expect(await storage.idempotency.claim(USER, "k-takeover", META, 60)).toMatchObject({
      outcome: "completed",
      responseBody: { id: "owner" },
    });
  });

  it("never releases a key that already holds a response", async () => {
    const token = await claimToken("k-done", 60);
    await storage.idempotency.complete(
      USER,
      "k-done",
      token,
      { statusCode: 200, responseBody: { ok: true } },
      DAY_SECONDS,
    );

    await storage.idempotency.release(USER, "k-done", token);

    expect((await storage.idempotency.claim(USER, "k-done", META, 60)).outcome).toBe("completed");
  });
});
