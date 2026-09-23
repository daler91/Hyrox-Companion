import { describe, expect, it } from "vitest";

import {
  bodyweightInput,
  changedFields,
  DEFAULT_ONBOARDING_PROFILE,
  firstRunUnitSuggestion,
  prefersImperialUnits,
  profileFromPreferences,
} from "@/hooks/onboardingProfile";
import type { UserPreferences } from "@/lib/api";

function prefs(overrides: Partial<UserPreferences> = {}): UserPreferences {
  return {
    weightUnit: "kg",
    distanceUnit: "km",
    division: "open",
    gender: null,
    trainingStyleId: "balanced_default",
    onboardingCompleted: false,
    ...overrides,
  } as UserPreferences;
}

describe("profileFromPreferences", () => {
  it("falls back to the defaults before the preferences load", () => {
    expect(profileFromPreferences()).toEqual(DEFAULT_ONBOARDING_PROFILE);
  });

  it("reads an established athlete's saved answers", () => {
    const profile = profileFromPreferences(
      prefs({
        weightUnit: "lbs",
        distanceUnit: "miles",
        division: "pro",
        gender: "female",
        trainingStyleId: "maf_method",
        mafAge: 41,
        mafCategory: "consistent_up_to_2y",
        mafHrDataAvailable: true,
        age: 41,
        heightCm: 168,
        activityLevel: "active",
        weightGoalDirection: "lose",
        aiCoachEnabled: true,
      }),
    );
    expect(profile).toEqual({
      weightUnit: "lbs",
      distanceUnit: "miles",
      division: "pro",
      gender: "female",
      trainingStyleId: "maf_method",
      mafAge: "41",
      mafCategory: "consistent_up_to_2y",
      mafHrDataAvailable: true,
      age: "41",
      heightCm: "168",
      activityLevel: "active",
      weightGoalDirection: "lose",
      aiCoachEnabled: true,
    });
  });

  it("shows an unanswered gender as prefer-not-to-say, like Settings does", () => {
    expect(profileFromPreferences(prefs({ gender: null })).gender).toBe("prefer_not_to_say");
    expect(profileFromPreferences(prefs({ gender: "unexpected" })).gender).toBe("prefer_not_to_say");
  });
});

describe("prefersImperialUnits", () => {
  it("is true only for a locale whose own region weighs in pounds", () => {
    expect(prefersImperialUnits(["en-US"])).toBe(true);
    expect(prefersImperialUnits(["en-GB", "en-US"])).toBe(false);
    expect(prefersImperialUnits(["de-DE"])).toBe(false);
  });

  it("never guesses a region the locale does not name", () => {
    expect(prefersImperialUnits(["en"])).toBe(false);
    expect(prefersImperialUnits([])).toBe(false);
    expect(prefersImperialUnits(["not a locale!"])).toBe(false);
  });
});

describe("firstRunUnitSuggestion", () => {
  it("suggests pounds and miles to an imperial first-run account on the defaults", () => {
    expect(firstRunUnitSuggestion(prefs(), true)).toEqual({ weightUnit: "lbs", distanceUnit: "miles" });
  });

  it("suggests nothing on a re-run, off the defaults, before load, or outside imperial locales", () => {
    expect(firstRunUnitSuggestion(prefs({ onboardingCompleted: true }), true)).toEqual({});
    expect(firstRunUnitSuggestion(prefs({ distanceUnit: "miles" }), true)).toEqual({});
    expect(firstRunUnitSuggestion(undefined, true)).toEqual({});
    expect(firstRunUnitSuggestion(prefs(), false)).toEqual({});
  });
});

describe("bodyweightInput", () => {
  it("formats saved kilograms in the unit shown, to one decimal", () => {
    expect(bodyweightInput(80, "kg")).toBe("80");
    expect(bodyweightInput(80, "lbs")).toBe("176.4");
    expect(bodyweightInput(null, "kg")).toBe("");
  });
});

describe("changedFields", () => {
  it("returns only the fields whose shown value differs from the saved one", () => {
    const saved = { ...DEFAULT_ONBOARDING_PROFILE, weightUnit: "lbs" as const, division: "pro" as const };
    const shown = { ...saved, distanceUnit: "miles" as const };
    expect(changedFields(shown, saved, ["weightUnit", "distanceUnit", "division", "gender"])).toEqual({
      distanceUnit: "miles",
    });
    expect(changedFields(saved, saved, ["weightUnit", "distanceUnit"])).toEqual({});
  });
});
