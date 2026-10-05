import { coachingMaterials, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The provider-calling step is the boundary under test: record whether it ran.
vi.mock("../server/services/ragService", () => ({ reembedAllMaterials: vi.fn() }));

import { db } from "../server/db";
import { reembedAllMaterials } from "../server/services/ragService";
import { resetIntegrationDb, seedUser } from "../server/storage/__tests__/integrationDb";
import { type Flags, processUser, targetUsers } from "./reembed-materials";

/**
 * P14 (CODEBASE_ANALYSIS_2026-10-03): this operator command sends every
 * targeted athlete's coaching-material text to the embedding provider from
 * outside the consent-gated routes, so it must leave out athletes who have not
 * switched AI processing on, and one who switches it off mid-run.
 */
describe("reembed-materials consent (real Postgres)", () => {
  const CONSENTING = "reembed-consenting";
  const DECLINING = "reembed-declining";
  const REBUILD: Flags = { dryRun: false, verifyOnly: false };

  async function setConsent(userId: string, aiCoachEnabled: boolean) {
    await db.update(users).set({ aiCoachEnabled }).where(eq(users.id, userId));
  }

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(CONSENTING);
    await seedUser(DECLINING);
    await setConsent(CONSENTING, true);
    await db.insert(coachingMaterials).values([
      { userId: CONSENTING, title: "Sled", content: "Short steps.", type: "document" },
      { userId: DECLINING, title: "Rowing", content: "Legs first.", type: "document" },
    ]);
    vi.mocked(reembedAllMaterials).mockReset();
    vi.mocked(reembedAllMaterials).mockResolvedValue({
      success: true,
      materialsProcessed: 1,
      errors: [],
    });
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  it("targets only owners who consent, and counts the ones left out", async () => {
    expect(await targetUsers(REBUILD)).toEqual({ userIds: [CONSENTING], withoutConsent: 1 });
  });

  it("leaves out a named athlete who has not consented", async () => {
    expect(await targetUsers({ ...REBUILD, userId: DECLINING })).toEqual({
      userIds: [],
      withoutConsent: 1,
    });
  });

  it("re-embeds an athlete who still consents", async () => {
    const outcome = await processUser(CONSENTING, REBUILD);

    expect(reembedAllMaterials).toHaveBeenCalledWith(CONSENTING);
    expect(outcome.consentWithdrawn).toBeUndefined();
  });

  it("skips an athlete who switched AI off after the run listed them", async () => {
    await setConsent(CONSENTING, false);

    const outcome = await processUser(CONSENTING, REBUILD);

    expect(reembedAllMaterials).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ consentWithdrawn: true, errors: [], unembedded: [] });
  });
});
