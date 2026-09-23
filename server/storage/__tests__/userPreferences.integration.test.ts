import { updateUserPreferencesSchema } from "@shared/schema";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

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
      expect((updated as Record<string, unknown> | undefined)?.[field]).toBe(value);

      const reread = await storage.users.getUser(USER);
      expect((reread as Record<string, unknown> | undefined)?.[field]).toBe(value);
    }
  });
});
