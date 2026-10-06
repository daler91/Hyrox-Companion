import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The provider is the boundary under test: record what would be sent to it and
// return empty vectors, so nothing is written to food_embeddings.
vi.mock("../../gemini/client", () => ({ EMBEDDING_DIMENSIONS: 3072, generateEmbeddings: vi.fn() }));

import { db } from "../../db";
import { generateEmbeddings } from "../../gemini/client";
import { ensureVectorSchema } from "../../maintenance";
import {
  resetIntegrationDb,
  seedCustomFood,
  seedUser,
} from "../../storage/__tests__/integrationDb";
import { __resetFoodEmbeddingScanForTests, embedMissingFoods } from "./foodEmbeddings";

/**
 * P14 (CODEBASE_ANALYSIS_2026-10-03): the food-embedding backfill cron runs
 * for every athlete, outside any consent-gated route, so its candidate scan is
 * what keeps a private custom food's name and brand away from the embedding
 * provider unless the food's owner has switched AI processing on.
 */
describe("embedMissingFoods candidate scan (real Postgres)", () => {
  const CONSENTING = "embed-consenting";
  const DECLINING = "embed-declining";

  // food_embeddings lives in the vector schema, which the server creates at
  // boot rather than drizzle-kit push, so a freshly pushed CI database lacks it.
  beforeAll(async () => {
    await ensureVectorSchema();
  });

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(CONSENTING);
    await seedUser(DECLINING);
    await db.update(users).set({ aiCoachEnabled: true }).where(eq(users.id, CONSENTING));
    vi.mocked(generateEmbeddings).mockReset();
    vi.mocked(generateEmbeddings).mockImplementation((texts) =>
      Promise.resolve(texts.map(() => [])),
    );
    __resetFoodEmbeddingScanForTests();
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

  // PF12 (CODEBASE_ANALYSIS_2026-10-03): the scan used to read the same
  // unordered prefix every run, so a food that never got stored (here: the
  // provider returns no vector at all) was picked again and again while the
  // rest waited. Each run now carries on in id order from the last.
  it("moves on through the foods in id order from one run to the next", async () => {
    await seedCustomFood(CONSENTING, "Third oats", { id: "pf12-c" });
    await seedCustomFood(CONSENTING, "First oats", { id: "pf12-a" });
    await seedCustomFood(CONSENTING, "Second oats", { id: "pf12-b" });

    await embedMissingFoods(1);
    await embedMissingFoods(1);
    await embedMissingFoods(1);

    expect(vi.mocked(generateEmbeddings).mock.calls).toEqual([
      [["First oats"]],
      [["Second oats"]],
      [["Third oats"]],
    ]);
  });

  it("never sends a private custom food that has no owner left to consent", async () => {
    await seedCustomFood(CONSENTING, "Orphaned private", { createdByUserId: null });

    await embedMissingFoods(5000);

    expect(sentTexts()).not.toContain("Orphaned private");
  });
});
