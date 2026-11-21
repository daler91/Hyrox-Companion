import { athleteFacts } from "@shared/schema";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "../server/db";
import { resetIntegrationDb, seedUser } from "../server/storage/__tests__/integrationDb";
import { collectCoachMemoryUsage } from "./coach-memory-usage";

/**
 * Tech debt #69: the coach-memory usage report had no query on athlete_facts,
 * so it could not say whether athletes use the athlete card it was meant to
 * gate. Real Postgres, since the report is one hand-written SQL statement.
 */
describe("coach-memory usage report (real Postgres)", () => {
  beforeEach(async () => {
    await resetIntegrationDb();
    for (const id of ["usage-a", "usage-b", "usage-c"]) await seedUser(id);
    await db.insert(athleteFacts).values([
      { userId: "usage-a", fact: "No sled at my gym", dedupeKey: "a1", category: "equipment", source: "athlete" },
      { userId: "usage-a", fact: "Left knee is sore", dedupeKey: "a2", category: "constraint", source: "chat" },
      { userId: "usage-b", fact: "Train before work", dedupeKey: "b1", category: "schedule", source: "plan_generation" },
      {
        userId: "usage-c",
        fact: "Shoulder healed",
        dedupeKey: "c1",
        category: "constraint",
        source: "athlete",
        active: false,
      },
    ]);
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  it("counts the athletes using the athlete card, by where their facts came from", async () => {
    const counts = new Map((await collectCoachMemoryUsage()).map(({ metric, users }) => [metric, users]));

    expect(counts.get("total users")).toBe(3);
    expect(counts.get("with >=1 active athlete-card fact")).toBe(2);
    expect(counts.get("  typed in Settings")).toBe(1);
    expect(counts.get("  from the plan wizard")).toBe(1);
    expect(counts.get("  from onboarding")).toBe(0);
    expect(counts.get("  saved from a coach proposal in chat")).toBe(1);
    expect(counts.get("with >=1 retired athlete-card fact")).toBe(1);
  });
});
