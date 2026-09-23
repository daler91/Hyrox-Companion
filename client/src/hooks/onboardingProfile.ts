import type { ActivityLevel, WeightGoalDirection } from "@shared/nutritionTargets";
import { kgToUserWeight } from "@shared/unitConversion";

import type { UserPreferences } from "@/lib/api";

export type OnboardingGender = "male" | "female" | "prefer_not_to_say";

/**
 * The saved preferences the onboarding wizard edits, in the shape its inputs
 * use (numbers the athlete types are strings). Bodyweight is absent on purpose:
 * its text depends on the weight unit shown at the time, so the wizard formats
 * it from `bodyweightKg` when it renders.
 */
export interface OnboardingProfile {
  weightUnit: "kg" | "lbs";
  distanceUnit: "km" | "miles";
  division: "open" | "pro";
  gender: OnboardingGender;
  trainingStyleId: string;
  mafAge: string;
  /** "" while unanswered. */
  mafCategory: string;
  mafHrDataAvailable: boolean;
  age: string;
  heightCm: string;
  activityLevel: "" | ActivityLevel;
  weightGoalDirection: WeightGoalDirection;
  /** The AI-processing consent the AI routes check; off for a new account. */
  aiCoachEnabled: boolean;
}

export const DEFAULT_ONBOARDING_PROFILE: OnboardingProfile = {
  weightUnit: "kg",
  distanceUnit: "km",
  division: "open",
  gender: "prefer_not_to_say",
  trainingStyleId: "balanced_default",
  mafAge: "",
  mafCategory: "",
  mafHrDataAvailable: false,
  age: "",
  heightCm: "",
  activityLevel: "",
  weightGoalDirection: "maintain",
  aiCoachEnabled: false,
};

const GENDERS: ReadonlySet<string> = new Set(["male", "female", "prefer_not_to_say"]);

function numberToInput(value: number | null | undefined): string {
  return value == null ? "" : String(value);
}

/**
 * What the athlete has saved, read into the wizard's shape. The wizard used to
 * start from hard-coded defaults instead, so "Run setup again" showed kg, km,
 * Open and Balanced to an athlete who had saved lbs, miles, Pro and MAF, and a
 * click on Continue overwrote them (onboarding audit H2).
 *
 * A null gender reads as "prefer_not_to_say", as it does in Settings and in the
 * Race Predictor, so leaving that answer as it is sends nothing and the column
 * keeps its "not answered yet" null.
 */
export function profileFromPreferences(prefs?: UserPreferences): OnboardingProfile {
  if (!prefs) return DEFAULT_ONBOARDING_PROFILE;
  return {
    weightUnit: prefs.weightUnit === "lbs" ? "lbs" : "kg",
    distanceUnit: prefs.distanceUnit === "miles" ? "miles" : "km",
    division: prefs.division === "pro" ? "pro" : "open",
    gender:
      prefs.gender != null && GENDERS.has(prefs.gender)
        ? (prefs.gender as OnboardingGender)
        : "prefer_not_to_say",
    trainingStyleId: prefs.trainingStyleId ?? "balanced_default",
    mafAge: numberToInput(prefs.mafAge),
    mafCategory: prefs.mafCategory ?? "",
    mafHrDataAvailable: prefs.mafHrDataAvailable ?? false,
    age: numberToInput(prefs.age),
    heightCm: numberToInput(prefs.heightCm),
    activityLevel: prefs.activityLevel ?? "",
    weightGoalDirection: prefs.weightGoalDirection ?? "maintain",
    aiCoachEnabled: prefs.aiCoachEnabled ?? false,
  };
}

// Regions that weigh in pounds and run in miles. Everywhere else, including
// the UK, races HYROX in kilograms and kilometres.
const IMPERIAL_REGIONS = new Set(["US", "LR", "MM"]);

// The locale's own region only, never a guessed one: maximize() would turn a
// bare "en" into en-Latn-US and suggest pounds to every English speaker.
function localeRegion(locale: string): string | undefined {
  try {
    return new Intl.Locale(locale).region;
  } catch {
    return undefined;
  }
}

// The DOM types promise a navigator, but there is none outside a browser.
function browserLanguages(): readonly string[] {
  return (globalThis.navigator as Navigator | undefined)?.languages ?? [];
}

/** True when the browser's first language belongs to an imperial region. */
export function prefersImperialUnits(languages: readonly string[] = browserLanguages()): boolean {
  const first = languages.at(0);
  if (!first) return false;
  const region = localeRegion(first);
  return region !== undefined && IMPERIAL_REGIONS.has(region);
}

/**
 * Units to suggest on a first run. New accounts are created with kg/km, so an
 * American athlete used to have to find the Pounds and Miles buttons
 * themselves (audit L4). The suggestion only applies to an account that has
 * not finished onboarding and still has those defaults; a re-run shows what
 * the athlete saved.
 */
export function firstRunUnitSuggestion(
  prefs: UserPreferences | undefined,
  imperial: boolean,
): Partial<OnboardingProfile> {
  if (!prefs || prefs.onboardingCompleted || !imperial) return {};
  if (prefs.weightUnit !== "kg" || prefs.distanceUnit !== "km") return {};
  return { weightUnit: "lbs", distanceUnit: "miles" };
}

/** The saved bodyweight as the wizard's text input shows it, in `unit`. */
export function bodyweightInput(bodyweightKg: number | null | undefined, unit: "kg" | "lbs"): string {
  if (bodyweightKg == null) return "";
  return String(Math.round(kgToUserWeight(bodyweightKg, unit) * 10) / 10);
}

/**
 * The fields among `keys` whose shown value differs from the saved one: the
 * only fields a step should write. Sending a step's every field used to write
 * the wizard's defaults over saved settings (audit H2).
 */
export function changedFields<K extends keyof OnboardingProfile>(
  shown: OnboardingProfile,
  saved: OnboardingProfile,
  keys: readonly K[],
): Partial<Pick<OnboardingProfile, K>> {
  const wanted = new Set<string>(keys);
  const savedValues = new Map<string, unknown>(Object.entries(saved));
  return Object.fromEntries(
    Object.entries(shown).filter(([key, value]) => wanted.has(key) && savedValues.get(key) !== value),
  ) as Partial<Pick<OnboardingProfile, K>>;
}
