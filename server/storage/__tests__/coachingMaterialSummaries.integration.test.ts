import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { storage } from "../index";
import { resetIntegrationDb, seedUser } from "./integrationDb";

/**
 * The Settings list's read (PF4, CODEBASE_ANALYSIS_2026-10-03): the length is
 * counted in Postgres, so the text never leaves the database for it.
 */
describe("listCoachingMaterialSummaries (real Postgres)", () => {
  const ALICE = "summary-alice";
  const BOB = "summary-bob";

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(ALICE);
    await seedUser(BOB);
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  it("returns the athlete's own materials, oldest first, with their lengths and no text", async () => {
    const principles = await storage.coaching.createCoachingMaterial({
      userId: ALICE,
      title: "Principles",
      content: "Easy days easy.",
      type: "principles",
    });
    const document = await storage.coaching.createCoachingMaterial({
      userId: ALICE,
      title: "Long read",
      content: "x".repeat(25_000),
      type: "document",
    });
    await storage.coaching.createCoachingMaterial({
      userId: BOB,
      title: "Bob's",
      content: "Not Alice's.",
      type: "document",
    });

    const summaries = await storage.coaching.listCoachingMaterialSummaries(ALICE);

    expect(summaries.map((summary) => summary.id)).toEqual([principles.id, document.id]);
    expect(summaries[0]).toMatchObject({
      title: "Principles",
      type: "principles",
      contentLength: 15,
    });
    expect(summaries[1]).toMatchObject({
      title: "Long read",
      type: "document",
      contentLength: 25_000,
    });
    expect(summaries[0]).not.toHaveProperty("content");
    expect(summaries[0]).not.toHaveProperty("userId");
  });

  it("counts characters, as the list's old content.length did for text without emoji", async () => {
    await storage.coaching.createCoachingMaterial({
      userId: ALICE,
      title: "Accents",
      content: "Fartlek à l'allure: déjà vu.",
      type: "principles",
    });

    const [summary] = await storage.coaching.listCoachingMaterialSummaries(ALICE);

    expect(summary?.contentLength).toBe("Fartlek à l'allure: déjà vu.".length);
  });
});
