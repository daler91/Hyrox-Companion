import { updateUserPreferencesSchema, userTrainingStyle } from "@shared/schema";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { db } from "../../db";
import { storage } from "../index";
import { resetIntegrationDb, seedUser } from "./integrationDb";

/**
 * Every value the preferences validator accepts must also fit the column it
 * lands in. The route tests mock storage, so they never met the column limits:
 * `users.gender` was varchar(16) while the validator allowed the 17-character
 * "prefer_not_to_say", and every onboarding Units save and every Settings save
 * carrying it returned 500 (onboarding audit C2).
 *
 * The fields are read off the validator itself, so an enum field or value added
 * to it later is covered without touching this test.
 */
function enumOptions(schema: z.ZodType): readonly string[] | null {
  let current: z.ZodType = schema;
  while (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
    current = current.unwrap() as z.ZodType;
  }
  return current instanceof z.ZodEnum ? (current.options as readonly string[]) : null;
}

const ENUM_FIELDS = Object.entries(updateUserPreferencesSchema.shape).flatMap(([field, schema]) => {
  const options = enumOptions(schema as z.ZodType);
  return options ? [{ field, options }] : [];
});

describe("UserStorage.updateUserPreferences round-trips every validator enum value (real Postgres)", () => {
  const USER = "prefs-roundtrip";

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(USER);
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  it("finds the enum fields to check", () => {
    expect(ENUM_FIELDS.map((f) => f.field)).toEqual(
      expect.arrayContaining(["weightUnit", "distanceUnit", "division", "gender", "activityLevel"]),
    );
  });

  it.each(ENUM_FIELDS)("stores and reads back every $field value", async ({ field, options }) => {
    for (const value of options) {
      const payload = updateUserPreferencesSchema.parse({ [field]: value });
      const updated = await storage.users.updateUserPreferences(USER, payload);
      expect(updated).toHaveProperty(field, value);

      const reread = await storage.users.getUser(USER);
      expect(reread).toHaveProperty(field, value);
    }
  });
});

/**
 * Tech debt #35: the previous style and the change time came from the client,
 * and nothing wrote user_training_style. The server now records both on a real
 * change, ignores client-sent values, and adds a history row.
 */
describe("UserStorage.updateUserPreferences records training-style changes (real Postgres)", () => {
  const USER = "prefs-style-history";

  async function history() {
    return await db
      .select({ style: userTrainingStyle.style, source: userTrainingStyle.source })
      .from(userTrainingStyle)
      .where(eq(userTrainingStyle.userId, USER))
      .orderBy(asc(userTrainingStyle.createdAt));
  }

  beforeEach(async () => {
    await resetIntegrationDb();
    await seedUser(USER);
  });

  afterAll(async () => {
    await resetIntegrationDb();
  });

  it("stamps the change itself, ignoring what the client sends", async () => {
    await storage.users.updateUserPreferences(USER, { onboardingCompleted: true });
    const before = Date.now();

    const updated = await storage.users.updateUserPreferences(USER, {
      trainingStyleId: "maf_method",
      trainingStylePreviousId: "client_says_this",
      trainingStyleChangedAt: new Date("2001-01-01T00:00:00Z"),
      mafAge: 40,
      mafCategory: "consistent_up_to_2y",
    });

    expect(updated?.trainingStyleId).toBe("maf_method");
    expect(updated?.trainingStylePreviousId).toBe("balanced_default");
    expect(updated?.trainingStyleChangedAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(await history()).toEqual([{ style: "maf_method", source: "settings" }]);
  });

  it("labels a change made before onboarding is complete as the wizard's", async () => {
    await storage.users.updateUserPreferences(USER, {
      trainingStyleId: "maf_method",
      mafAge: 40,
      mafCategory: "consistent_up_to_2y",
    });

    expect(await history()).toEqual([{ style: "maf_method", source: "onboarding" }]);
  });

  it("writes nothing for a save that keeps the same style, or sends none", async () => {
    await storage.users.updateUserPreferences(USER, { trainingStyleId: "balanced_default" });
    const kept = await storage.users.updateUserPreferences(USER, {
      weeklyGoal: 4,
      trainingStylePreviousId: "client_says_this",
    });

    expect(kept?.trainingStylePreviousId).toBeNull();
    expect(kept?.trainingStyleChangedAt).toBeNull();
    expect(await history()).toEqual([]);
  });
});
