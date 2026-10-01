import { MAX_ACTIVE_ATHLETE_FACTS } from "@shared/athleteFacts";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { storage } from "../index";
import { resetIntegrationDb, seedUser } from "./integrationDb";

/**
 * The athlete card against the REAL schema: the upsert that re-confirms a fact
 * stated twice, the active cap under the advisory lock, the CHECKs, and the
 * cascade from the user. The route tests mock all of this.
 */
describe("athlete facts (real Postgres)", () => {
  const ALICE = "facts-alice";
  const BOB = "facts-bob";
  const REVIEW = "2026-12-30";

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(ALICE);
    await seedUser(BOB);
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  it("re-confirms a fact stated again instead of adding a second, waking a retired one", async () => {
    const first = await storage.athleteFacts.add(ALICE, { fact: "No sled at my gym.", category: "equipment", source: "athlete" }, "2026-11-01");
    if (!first.ok) throw new Error("expected the first add to succeed");
    await storage.athleteFacts.update(ALICE, first.fact.id, { active: false });

    const again = await storage.athleteFacts.add(ALICE, { fact: "no  sled at my gym", category: "equipment", source: "chat" }, REVIEW);

    expect(again).toMatchObject({ ok: true, created: false });
    const facts = await storage.athleteFacts.list(ALICE);
    expect(facts).toHaveLength(1);
    // Active again, newest wording, review moved out; where it came from first is kept.
    expect(facts[0]).toMatchObject({ fact: "no sled at my gym", active: true, reviewOn: REVIEW, source: "athlete" });
  });

  it("holds an athlete to the active cap, while a fact they already have still re-confirms", async () => {
    const seeded = await storage.athleteFacts.seed(
      ALICE,
      Array.from({ length: MAX_ACTIVE_ATHLETE_FACTS + 2 }, (_, i) => ({ fact: `Fact number ${i}`, category: "other" as const, source: "plan_generation" as const })),
      REVIEW,
    );

    expect(seeded).toEqual({ added: MAX_ACTIVE_ATHLETE_FACTS, skipped: 2 });
    expect(await storage.athleteFacts.add(ALICE, { fact: "One more", category: "other", source: "athlete" }, REVIEW)).toEqual({ ok: false, reason: "limit" });
    expect(await storage.athleteFacts.add(ALICE, { fact: "Fact number 0", category: "other", source: "athlete" }, REVIEW)).toMatchObject({ ok: true, created: false });
    // Bob's card is his own.
    expect(await storage.athleteFacts.add(BOB, { fact: "One more", category: "other", source: "athlete" }, REVIEW)).toMatchObject({ ok: true, created: true });
  });

  it("never lets two writes at once take an athlete past the cap", async () => {
    await storage.athleteFacts.seed(
      ALICE,
      Array.from({ length: MAX_ACTIVE_ATHLETE_FACTS - 1 }, (_, i) => ({ fact: `Fact ${i}`, category: "other" as const, source: "athlete" as const })),
      REVIEW,
    );

    const results = await Promise.all(
      ["Late one", "Late two", "Late three"].map((fact) => storage.athleteFacts.add(ALICE, { fact, category: "other", source: "athlete" }, REVIEW)),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await storage.athleteFacts.listActive(ALICE)).toHaveLength(MAX_ACTIVE_ATHLETE_FACTS);
  });

  it("edits, refusing wording another fact already has, and keeps everything to its owner", async () => {
    const knee = await storage.athleteFacts.add(ALICE, { fact: "Bad left knee", category: "constraint", source: "athlete" }, REVIEW);
    await storage.athleteFacts.add(ALICE, { fact: "No sled at my gym", category: "equipment", source: "athlete" }, REVIEW);
    if (!knee.ok) throw new Error("expected the add to succeed");

    expect(await storage.athleteFacts.update(ALICE, knee.fact.id, { fact: "No sled at my gym." })).toEqual({ ok: false, reason: "duplicate" });
    expect(await storage.athleteFacts.update(BOB, knee.fact.id, { active: false })).toEqual({ ok: false, reason: "not_found" });
    expect(await storage.athleteFacts.delete(BOB, knee.fact.id)).toBe(false);

    const edited = await storage.athleteFacts.update(ALICE, knee.fact.id, { fact: "Bad left knee: no deep lunges", category: "constraint" });
    expect(edited).toMatchObject({ ok: true, fact: { fact: "Bad left knee: no deep lunges", dedupeKey: "bad left knee: no deep lunges" } });
    expect(await storage.athleteFacts.delete(ALICE, knee.fact.id)).toBe(true);
    expect((await storage.athleteFacts.list(ALICE)).map((row) => row.fact)).toEqual(["No sled at my gym"]);
  });

  it("refuses a category or source the schema doesn't know, and goes with the athlete", async () => {
    await expect(
      storage.athleteFacts.add(ALICE, { fact: "x", category: "bogus" as never, source: "athlete" }, REVIEW),
    ).rejects.toThrow();
    await expect(
      storage.athleteFacts.add(ALICE, { fact: "x", category: "other", source: "bogus" as never }, REVIEW),
    ).rejects.toThrow();

    await storage.athleteFacts.add(ALICE, { fact: "Bad left knee", category: "constraint", source: "athlete" }, REVIEW);
    await resetIntegrationDb();
    expect(await storage.athleteFacts.list(ALICE)).toEqual([]);
  });
});
