import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { storage } from "../index";
import { resetIntegrationDb, seedCustomFood, seedUser } from "./integrationDb";

/**
 * The nutrition storage layer against the REAL schema. Nutrition ships ON in
 * production, yet its 1,192-line storage class had only render-only SQL-shape
 * tests: no food-log row was ever written or read through Postgres in CI.
 * These cover the food-logging round trip, the visibility predicate that
 * once leaked deleted users' foods, ownership on entry writes, and the
 * one-version-per-day contract migration 0091 made the database enforce.
 */
describe("NutritionStorage (real Postgres)", () => {
  const ALICE = "nutri-alice";
  const BOB = "nutri-bob";
  const DAY = "2026-08-15";

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(ALICE);
    await seedUser(BOB);
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  describe("visibility (visibleTo)", () => {
    it("shows an athlete their own private custom food, and nobody else's", async () => {
      const mine = await seedCustomFood(ALICE, "Alice's private oats");
      const theirs = await seedCustomFood(BOB, "Bob's private rice");

      expect(await storage.nutrition.getVisibleFoodById(ALICE, mine.id)).toMatchObject({ id: mine.id });
      expect(await storage.nutrition.getVisibleFoodById(ALICE, theirs.id)).toBeUndefined();
    });

    it("shows a PUBLIC custom food to everyone, including one whose owner is gone", async () => {
      const shared = await seedCustomFood(BOB, "Bob's shared granola", { isPublic: true });
      const orphanedPublic = await seedCustomFood(BOB, "Orphaned public", { isPublic: true, createdByUserId: null });
      const orphanedPrivate = await seedCustomFood(BOB, "Orphaned private", { createdByUserId: null });

      expect(await storage.nutrition.getVisibleFoodById(ALICE, shared.id)).toMatchObject({ id: shared.id });
      expect(await storage.nutrition.getVisibleFoodById(ALICE, orphanedPublic.id)).toMatchObject({ id: orphanedPublic.id });
      // The round-1 GDPR leak: a NULL owner must never read as "shared".
      expect(await storage.nutrition.getVisibleFoodById(ALICE, orphanedPrivate.id)).toBeUndefined();
    });
  });

  describe("food logging round trip", () => {
    it("writes an entry and reads it back joined to its food, scoped to the athlete", async () => {
      const oats = await seedCustomFood(ALICE, "Alice's oats");

      const entry = await storage.nutrition.createLogEntry(ALICE, {
        foodId: oats.id,
        quantityG: 80,
        mealType: "breakfast",
        loggedAt: new Date(`${DAY}T07:30:00Z`),
        logDate: DAY,
      });
      expect(entry).toMatchObject({ userId: ALICE, foodId: oats.id, quantityG: 80, entryMethod: "manual" });

      const alicesDay = await storage.nutrition.listEntriesWithFoodForDate(ALICE, DAY);
      expect(alicesDay).toHaveLength(1);
      expect(alicesDay[0]).toMatchObject({ id: entry.id, food: { id: oats.id, name: "Alice's oats" } });

      expect(await storage.nutrition.listEntriesWithFoodForDate(BOB, DAY)).toEqual([]);
      expect(await storage.nutrition.listEntriesWithFoodForDate(ALICE, "2026-08-16")).toEqual([]);
      expect(await storage.nutrition.hasEntriesOnDate(ALICE, DAY)).toBe(true);
      expect(await storage.nutrition.hasEntriesOnDate(BOB, DAY)).toBe(false);
    });

    it("only the owner can update or delete an entry", async () => {
      const oats = await seedCustomFood(ALICE, "Alice's oats");
      const entry = await storage.nutrition.createLogEntry(ALICE, {
        foodId: oats.id,
        quantityG: 80,
        mealType: "breakfast",
        loggedAt: new Date(`${DAY}T07:30:00Z`),
        logDate: DAY,
      });

      expect(await storage.nutrition.updateLogEntry(BOB, entry.id, { quantityG: 500 })).toBeUndefined();
      expect(await storage.nutrition.deleteLogEntry(BOB, entry.id)).toBe(false);
      expect(await storage.nutrition.listEntriesWithFoodForDate(ALICE, DAY)).toHaveLength(1);

      expect(await storage.nutrition.updateLogEntry(ALICE, entry.id, { quantityG: 120 })).toMatchObject({ quantityG: 120 });
      expect(await storage.nutrition.deleteLogEntry(ALICE, entry.id)).toBe(true);
      expect(await storage.nutrition.listEntriesWithFoodForDate(ALICE, DAY)).toEqual([]);
    });
  });

  describe("versioned targets (one row per user+day, enforced by migration 0091)", () => {
    it("re-saving the same day replaces that version rather than stacking a duplicate", async () => {
      await storage.nutrition.createTarget(ALICE, { effectiveFrom: DAY, calories: 2000, proteinG: 150 });
      await storage.nutrition.createTarget(ALICE, { effectiveFrom: DAY, calories: 2100, proteinG: 160 });

      const versions = await storage.nutrition.listTargets(ALICE);
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({ effectiveFrom: DAY, calories: 2100, proteinG: 160 });
      expect(await storage.nutrition.getCurrentTarget(ALICE, DAY)).toMatchObject({ calories: 2100 });
    });

    it("keeps history across distinct effective dates and resolves the latest one on or before a date", async () => {
      await storage.nutrition.createTarget(ALICE, { effectiveFrom: "2026-08-01", calories: 1900 });
      await storage.nutrition.createTarget(ALICE, { effectiveFrom: "2026-08-20", calories: 2300 });

      expect(await storage.nutrition.getCurrentTarget(ALICE, "2026-08-15")).toMatchObject({ calories: 1900 });
      expect(await storage.nutrition.getCurrentTarget(ALICE, "2026-08-25")).toMatchObject({ calories: 2300 });
      expect(await storage.nutrition.getCurrentTarget(ALICE, "2026-07-31")).toBeUndefined();
      expect(await storage.nutrition.getCurrentTarget(BOB, "2026-08-25")).toBeUndefined();
    });
  });
});
