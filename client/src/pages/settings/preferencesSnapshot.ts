import type {
  MafConsistencyInput,
  MafHrDataAvailableInput,
  MafTrendInput,
} from "@/components/settings/TrainingStyleSection";
import type { UserPreferences } from "@/lib/api";

// The save mutation sends weeklyGoal as a number; local form state stores
// it as a string so the <Input type="number"> can hold a partially-typed
// value. `PreferencesSnapshot` captures the form-state shape (weeklyGoal as
// string) used for Undo + committed-state tracking.
//
// `userTimezone` is excluded everywhere here: Settings does not expose a
// timezone editor — the value is auto-detected on the client and PATCHed
// independently by useDetectTimezone (C10). Keeping it out of the snapshot
// + save payload means a Settings save never overwrites the auto-detected
// value with stale state.
export type ActivityLevelValue = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type WeightGoalDirectionValue = "lose" | "maintain" | "gain";

export type SavePayload = Omit<UserPreferences, "weeklyGoal" | "userTimezone"> & {
  weeklyGoal: number;
};

export interface PreferencesSnapshot
  extends Omit<
    UserPreferences,
    | "weeklyGoal"
    | "userTimezone"
    | "trainingStyleId"
    | "age"
    | "mafAge"
    | "mafConsistency"
    | "mafTrend"
    | "mafHrDataAvailable"
    | "bodyweightKg"
    | "heightCm"
    | "restingHr"
    | "maxHr"
    | "ftp"
    | "activityLevel"
    | "weightGoalDirection"
    | "weightGoalRateKgPerWeek"
  > {
  weeklyGoal: string;
  mealSchedule: 3 | 4 | 5;
  division: string;
  gender: string;
  age: number | null;
  // Body-composition inputs, stored canonical (kg/cm) for stable dirty-tracking.
  bodyweightKg: number | null;
  heightCm: number | null;
  // Training-load HR/power baselines (bpm/bpm/watts).
  restingHr: number | null;
  maxHr: number | null;
  ftp: number | null;
  activityLevel: ActivityLevelValue | null;
  weightGoalDirection: WeightGoalDirectionValue | null;
  weightGoalRateKgPerWeek: number | null;
  trainingStyleId: string;
  mafAge: number | null;
  mafConsistency: Exclude<MafConsistencyInput, ""> | null;
  mafTrend: Exclude<MafTrendInput, ""> | null;
  mafHrDataAvailable: boolean | null;
}

// The live form state. Numeric inputs are kept as strings so
// <Input type="number"> can hold partially-typed values; the snapshot
// converters below normalize them for dirty-tracking and saving.
export interface PreferencesDraft {
  weightUnit: string;
  distanceUnit: string;
  division: string;
  gender: string;
  ageInput: string;
  bodyweightKg: number | null;
  heightCm: number | null;
  restingHrInput: string;
  maxHrInput: string;
  ftpInput: string;
  activityLevel: string;
  weightGoalDirection: string;
  weightGoalRateKgPerWeek: number | null;
  weeklyGoal: string;
  mealSchedule: 3 | 4 | 5;
  emailNotifications: boolean;
  emailWeeklySummary: boolean;
  emailMissedReminder: boolean;
  showAdherenceInsights: boolean;
  aiCoachEnabled: boolean;
  coachAutoApplyPlanChanges: boolean;
  trainingStyleId: string;
  mafAgeInput: string;
  mafConsistencyInput: MafConsistencyInput;
  mafTrendInput: MafTrendInput;
  mafHrDataAvailableInput: MafHrDataAvailableInput;
}

export function ageInputToSnapshot(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

export function mafHrDataAvailableInputToSnapshot(value: MafHrDataAvailableInput): boolean | null {
  if (!value) {
    return null;
  }
  return value === "yes";
}

export function mafHrDataAvailableToInput(value: boolean | null | undefined): MafHrDataAvailableInput {
  if (value == null) {
    return "";
  }
  return value ? "yes" : "no";
}

// Initial local defaults. Used as a fallback dirty-tracking baseline if
// remote preferences never load (e.g. query error) so edits can still
// surface the sticky save bar.
export const DEFAULT_PREFERENCES_DRAFT: PreferencesDraft = {
  weightUnit: "kg",
  distanceUnit: "km",
  division: "open",
  gender: "prefer_not_to_say",
  ageInput: "",
  bodyweightKg: null,
  heightCm: null,
  restingHrInput: "",
  maxHrInput: "",
  ftpInput: "",
  activityLevel: "",
  weightGoalDirection: "",
  weightGoalRateKgPerWeek: null,
  weeklyGoal: "5",
  mealSchedule: 4,
  emailNotifications: false,
  emailWeeklySummary: false,
  emailMissedReminder: false,
  showAdherenceInsights: true,
  aiCoachEnabled: false,
  coachAutoApplyPlanChanges: false,
  trainingStyleId: "balanced_default",
  mafAgeInput: "",
  mafConsistencyInput: "",
  mafTrendInput: "",
  mafHrDataAvailableInput: "",
};

export function draftToSnapshot(draft: PreferencesDraft): PreferencesSnapshot {
  return {
    weightUnit: draft.weightUnit,
    distanceUnit: draft.distanceUnit,
    division: draft.division,
    gender: draft.gender,
    age: ageInputToSnapshot(draft.ageInput),
    bodyweightKg: draft.bodyweightKg,
    heightCm: draft.heightCm,
    restingHr: ageInputToSnapshot(draft.restingHrInput),
    maxHr: ageInputToSnapshot(draft.maxHrInput),
    ftp: ageInputToSnapshot(draft.ftpInput),
    activityLevel: (draft.activityLevel || null) as ActivityLevelValue | null,
    weightGoalDirection: (draft.weightGoalDirection || null) as WeightGoalDirectionValue | null,
    weightGoalRateKgPerWeek: draft.weightGoalRateKgPerWeek,
    weeklyGoal: draft.weeklyGoal,
    mealSchedule: draft.mealSchedule,
    emailNotifications: draft.emailNotifications,
    emailWeeklySummary: draft.emailWeeklySummary,
    emailMissedReminder: draft.emailMissedReminder,
    showAdherenceInsights: draft.showAdherenceInsights,
    aiCoachEnabled: draft.aiCoachEnabled,
    coachAutoApplyPlanChanges: draft.coachAutoApplyPlanChanges,
    trainingStyleId: draft.trainingStyleId,
    mafAge: ageInputToSnapshot(draft.mafAgeInput),
    mafConsistency: draft.mafConsistencyInput || null,
    mafTrend: draft.mafTrendInput || null,
    mafHrDataAvailable: mafHrDataAvailableInputToSnapshot(draft.mafHrDataAvailableInput),
  };
}

export const DEFAULT_PREFERENCES_SNAPSHOT: PreferencesSnapshot =
  draftToSnapshot(DEFAULT_PREFERENCES_DRAFT);

export function preferencesToDraft(preferences: UserPreferences): PreferencesDraft {
  return {
    weightUnit: preferences.weightUnit || "kg",
    distanceUnit: preferences.distanceUnit || "km",
    division: preferences.division || "open",
    gender: preferences.gender ?? "prefer_not_to_say",
    ageInput: preferences.age == null ? "" : String(preferences.age),
    bodyweightKg: preferences.bodyweightKg ?? null,
    heightCm: preferences.heightCm ?? null,
    restingHrInput: preferences.restingHr == null ? "" : String(preferences.restingHr),
    maxHrInput: preferences.maxHr == null ? "" : String(preferences.maxHr),
    ftpInput: preferences.ftp == null ? "" : String(preferences.ftp),
    activityLevel: preferences.activityLevel ?? "",
    weightGoalDirection: preferences.weightGoalDirection ?? "",
    weightGoalRateKgPerWeek: preferences.weightGoalRateKgPerWeek ?? null,
    weeklyGoal: String(preferences.weeklyGoal || 5),
    mealSchedule: preferences.mealSchedule ?? 4,
    emailNotifications: preferences.emailNotifications ?? false,
    emailWeeklySummary: preferences.emailWeeklySummary ?? false,
    emailMissedReminder: preferences.emailMissedReminder ?? false,
    showAdherenceInsights: preferences.showAdherenceInsights ?? true,
    aiCoachEnabled: preferences.aiCoachEnabled ?? false,
    coachAutoApplyPlanChanges: preferences.coachAutoApplyPlanChanges ?? false,
    trainingStyleId: preferences.trainingStyleId ?? "balanced_default",
    mafAgeInput: preferences.mafAge == null ? "" : String(preferences.mafAge),
    mafConsistencyInput: preferences.mafConsistency ?? "",
    mafTrendInput: preferences.mafTrend ?? "",
    mafHrDataAvailableInput: mafHrDataAvailableToInput(preferences.mafHrDataAvailable),
  };
}

export function snapshotToDraft(snapshot: PreferencesSnapshot): PreferencesDraft {
  return {
    weightUnit: snapshot.weightUnit,
    distanceUnit: snapshot.distanceUnit,
    division: snapshot.division,
    gender: snapshot.gender,
    ageInput: snapshot.age == null ? "" : String(snapshot.age),
    bodyweightKg: snapshot.bodyweightKg,
    heightCm: snapshot.heightCm,
    restingHrInput: snapshot.restingHr == null ? "" : String(snapshot.restingHr),
    maxHrInput: snapshot.maxHr == null ? "" : String(snapshot.maxHr),
    ftpInput: snapshot.ftp == null ? "" : String(snapshot.ftp),
    activityLevel: snapshot.activityLevel ?? "",
    weightGoalDirection: snapshot.weightGoalDirection ?? "",
    weightGoalRateKgPerWeek: snapshot.weightGoalRateKgPerWeek,
    weeklyGoal: snapshot.weeklyGoal,
    mealSchedule: snapshot.mealSchedule,
    emailNotifications: snapshot.emailNotifications,
    emailWeeklySummary: snapshot.emailWeeklySummary,
    emailMissedReminder: snapshot.emailMissedReminder,
    showAdherenceInsights: snapshot.showAdherenceInsights,
    aiCoachEnabled: snapshot.aiCoachEnabled,
    coachAutoApplyPlanChanges: snapshot.coachAutoApplyPlanChanges,
    trainingStyleId: snapshot.trainingStyleId,
    mafAgeInput: snapshot.mafAge == null ? "" : String(snapshot.mafAge),
    mafConsistencyInput: snapshot.mafConsistency ?? "",
    mafTrendInput: snapshot.mafTrend ?? "",
    mafHrDataAvailableInput: mafHrDataAvailableToInput(snapshot.mafHrDataAvailable),
  };
}

export function preferencesToSnapshot(preferences: UserPreferences): PreferencesSnapshot {
  return {
    weightUnit: preferences.weightUnit || "kg",
    distanceUnit: preferences.distanceUnit || "km",
    division: preferences.division || "open",
    gender: preferences.gender ?? "prefer_not_to_say",
    age: preferences.age ?? null,
    bodyweightKg: preferences.bodyweightKg ?? null,
    heightCm: preferences.heightCm ?? null,
    restingHr: preferences.restingHr ?? null,
    maxHr: preferences.maxHr ?? null,
    ftp: preferences.ftp ?? null,
    activityLevel: preferences.activityLevel ?? null,
    weightGoalDirection: preferences.weightGoalDirection ?? null,
    weightGoalRateKgPerWeek: preferences.weightGoalRateKgPerWeek ?? null,
    weeklyGoal: String(preferences.weeklyGoal || 5),
    mealSchedule: preferences.mealSchedule ?? 4,
    emailNotifications: preferences.emailNotifications ?? false,
    emailWeeklySummary: preferences.emailWeeklySummary ?? false,
    emailMissedReminder: preferences.emailMissedReminder ?? false,
    showAdherenceInsights: preferences.showAdherenceInsights ?? true,
    aiCoachEnabled: preferences.aiCoachEnabled ?? false,
    coachAutoApplyPlanChanges: preferences.coachAutoApplyPlanChanges ?? false,
    trainingStyleId: preferences.trainingStyleId ?? "balanced_default",
    mafAge: preferences.mafAge ?? null,
    mafConsistency: preferences.mafConsistency ?? null,
    mafTrend: preferences.mafTrend ?? null,
    mafHrDataAvailable: preferences.mafHrDataAvailable ?? null,
  };
}

export function savePayloadToSnapshot(payload: SavePayload): PreferencesSnapshot {
  return {
    weightUnit: payload.weightUnit,
    distanceUnit: payload.distanceUnit,
    division: payload.division ?? "open",
    gender: payload.gender ?? "prefer_not_to_say",
    age: payload.age ?? null,
    bodyweightKg: payload.bodyweightKg ?? null,
    heightCm: payload.heightCm ?? null,
    restingHr: payload.restingHr ?? null,
    maxHr: payload.maxHr ?? null,
    ftp: payload.ftp ?? null,
    activityLevel: payload.activityLevel ?? null,
    weightGoalDirection: payload.weightGoalDirection ?? null,
    weightGoalRateKgPerWeek: payload.weightGoalRateKgPerWeek ?? null,
    weeklyGoal: String(payload.weeklyGoal),
    mealSchedule: payload.mealSchedule ?? 4,
    emailNotifications: payload.emailNotifications,
    emailWeeklySummary: payload.emailWeeklySummary,
    emailMissedReminder: payload.emailMissedReminder,
    showAdherenceInsights: payload.showAdherenceInsights,
    aiCoachEnabled: payload.aiCoachEnabled,
    coachAutoApplyPlanChanges: payload.coachAutoApplyPlanChanges,
    trainingStyleId: payload.trainingStyleId ?? "balanced_default",
    mafAge: payload.mafAge ?? null,
    mafConsistency: payload.mafConsistency ?? null,
    mafTrend: payload.mafTrend ?? null,
    mafHrDataAvailable: payload.mafHrDataAvailable ?? null,
  };
}

export function snapshotToSavePayload(snapshot: PreferencesSnapshot): SavePayload {
  return {
    weightUnit: snapshot.weightUnit,
    distanceUnit: snapshot.distanceUnit,
    division: snapshot.division,
    gender: snapshot.gender,
    age: snapshot.age,
    bodyweightKg: snapshot.bodyweightKg,
    heightCm: snapshot.heightCm,
    restingHr: snapshot.restingHr,
    maxHr: snapshot.maxHr,
    ftp: snapshot.ftp,
    activityLevel: snapshot.activityLevel,
    weightGoalDirection: snapshot.weightGoalDirection,
    weightGoalRateKgPerWeek: snapshot.weightGoalRateKgPerWeek,
    weeklyGoal: Number.parseInt(snapshot.weeklyGoal, 10),
    mealSchedule: snapshot.mealSchedule,
    emailNotifications: snapshot.emailNotifications,
    emailWeeklySummary: snapshot.emailWeeklySummary,
    emailMissedReminder: snapshot.emailMissedReminder,
    showAdherenceInsights: snapshot.showAdherenceInsights,
    aiCoachEnabled: snapshot.aiCoachEnabled,
    coachAutoApplyPlanChanges: snapshot.coachAutoApplyPlanChanges,
    trainingStyleId: snapshot.trainingStyleId,
    mafAge: snapshot.mafAge,
    mafConsistency: snapshot.mafConsistency,
    mafTrend: snapshot.mafTrend,
    mafHrDataAvailable: snapshot.mafHrDataAvailable,
  };
}
