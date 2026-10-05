import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The provider is the boundary under test: record what would be sent to it and
// return empty vectors, so nothing is written to food_embeddings.
vi.mock("../../gemini/client", () => ({ EMBEDDING_DIMENSIONS: 3072, generateEmbeddings: vi.fn() }));

import { db } from "../../db";
import { generateEmbeddings } from "../../gemini/client";
import {
  resetIntegrationDb,
  seedCustomFood,
  seedUser,
} from "../../storage/__tests__/integrationDb";
import { embedMissingFoods } from "./foodEmbeddings";

/**
 * P14 (CODEBASE_ANALYSIS_2026-10-03): the food-embedding backfill cron runs
 * for every athlete, outside any consent-gated route, so its candidate scan is
 * what keeps a private custom food's name and brand away from the embedding
 * provider unless the food's owner has switched AI processing on.
 */
describe("embedMissingFoods candidate scan (real Postgres)", () => {
  const CONSENTING = "embed-consenting";
  const DECLINING = "embed-declining";

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(CONSENTING);
    await seedUser(DECLINING);
    await db.update(users).set({ aiCoachEnabled: true }).where(eq(users.id, CONSENTING));
    vi.mocked(generateEmbeddings).mockReset();
    vi.mocked(generateEmbeddings).mockImplementation((texts) =>
      Promise.resolve(texts.map(() => [])),
    );
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  /** Every text the backfill handed to the provider. */
  function sentTexts(): string[] {
    return vi.mocked(generateEmbeddings).mock.calls.flatMap(([texts]) => texts);
  }

  it("sends a private custom food only when its owner consents to AI processing", async () => {
    await seedCustomFood(CONSENTING, "Consenting oats");
    await seedCustomFood(DECLINING, "Declining rice", { brand: "Home" });

    await embedMissingFoods(5000);

    expect(sentTexts()).toContain("Consenting oats");
    expect(sentTexts()).not.toContain("Declining rice Home");
  });

  it("still sends a custom food its owner shared publicly", async () => {
    await seedCustomFood(DECLINING, "Shared granola", { isPublic: true });

    await embedMissingFoods(5000);

    expect(sentTexts()).toContain("Shared granola");
  });

  it("never sends a private custom food that has no owner left to consent", async () => {
    await seedCustomFood(CONSENTING, "Orphaned private", { createdByUserId: null });

    await embedMissingFoods(5000);

    expect(sentTexts()).not.toContain("Orphaned private");
  });
});
