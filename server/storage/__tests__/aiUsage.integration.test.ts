import { aiUsageLogs, users } from "@shared/schema";
import { eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../../db";
import { storage } from "../index";
import { seedUser } from "./integrationDb";

/**
 * Usage rows with no athlete (tech debt #41): the food-embedding backfill
 * embeds the shared food cache, so its spend belongs to no one. Such a row
 * must count toward the app-wide ceiling and toward no athlete's daily cap or
 * export, against the real schema (user_id is nullable since migration 0127).
 *
 * Cleans up only its own rows rather than resetting the whole database.
 */

const ATHLETE = "ai-usage-system-rows-athlete";
const SYSTEM_MODEL = "test-system-embedding-model";

async function cleanUp(): Promise<void> {
  await db.delete(aiUsageLogs).where(eq(aiUsageLogs.model, SYSTEM_MODEL));
  await db.delete(aiUsageLogs).where(eq(aiUsageLogs.userId, ATHLETE));
  await db.delete(users).where(inArray(users.id, [ATHLETE]));
}

beforeEach(async () => {
  await cleanUp();
  await seedUser(ATHLETE);
});

afterAll(async () => {
  await cleanUp();
});

describe("AI usage rows with no athlete", () => {
  it("count toward the app-wide total, and toward no athlete's total or export", async () => {
    const globalBefore = await storage.aiUsage.getGlobalDailyTotalCents();

    await storage.aiUsage.insertUsageLog({
      userId: ATHLETE,
      model: SYSTEM_MODEL,
      feature: "chat",
      inputTokens: 100,
      outputTokens: 0,
      estimatedCostCents: 2,
    });
    await storage.aiUsage.insertUsageLog({
      userId: null,
      model: SYSTEM_MODEL,
      feature: "food_embedding",
      inputTokens: 1000,
      outputTokens: 0,
      estimatedCostCents: 3,
    });

    expect(await storage.aiUsage.getGlobalDailyTotalCents()).toBeCloseTo(globalBefore + 5);
    expect(await storage.aiUsage.getDailyTotalCents(ATHLETE)).toBeCloseTo(2);

    const exported = await storage.aiUsage.listForUser(ATHLETE);
    expect(exported.map((row) => row.feature)).toEqual(["chat"]);

    const systemRows = await db.select().from(aiUsageLogs).where(isNull(aiUsageLogs.userId));
    expect(systemRows.some((row) => row.model === SYSTEM_MODEL && row.feature === "food_embedding")).toBe(true);
  });
});
