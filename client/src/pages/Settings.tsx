import { calculateMafHr } from "@shared/maf";
import { useMutation,useQuery } from "@tanstack/react-query";
import { Bell, Database, Dumbbell, Link2, Loader2, RotateCw, User } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";

import { AccountDangerZone } from "@/components/settings/AccountDangerZone";
import { CoachingSection } from "@/components/settings/CoachingSection";
import { DataToolsSection } from "@/components/settings/DataToolsSection";
import { GarminSection } from "@/components/settings/GarminSection";
import { AiCoachCard } from "@/components/settings/preferences/AiCoachCard";
import { AthleteProfileCard } from "@/components/settings/preferences/AthleteProfileCard";
import { BodyCompositionCard } from "@/components/settings/preferences/BodyCompositionCard";
import { EmailNotificationsCard } from "@/components/settings/preferences/EmailNotificationsCard";
import { HealthMetricsCard } from "@/components/settings/preferences/HealthMetricsCard";
import { NutritionPreferencesCard } from "@/components/settings/preferences/NutritionPreferencesCard";
import { TrainingGoalsCard } from "@/components/settings/preferences/TrainingGoalsCard";
import { UnitsPreferencesCard } from "@/components/settings/preferences/UnitsPreferencesCard";
import { WorkoutReviewCard } from "@/components/settings/preferences/WorkoutReviewCard";
import { ProfileSection } from "@/components/settings/ProfileSection";
import { PushNotificationSection } from "@/components/settings/PushNotificationSection";
import { StravaSection } from "@/components/settings/StravaSection";
import {
  buildRecalculationSummary,
  type MafConsistencyInput,
  type MafHrDataAvailableInput,
  type MafTrendInput,
  type StyleAuditEntry,
  TrainingStyleSection,
} from "@/components/settings/TrainingStyleSection";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { PageContainer } from "@/components/ui/PageContainer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToastAction } from "@/components/ui/toast";
import { clearLocalOnboardingComplete } from "@/hooks/onboardingStorage";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useUnsavedChangesPrompt } from "@/hooks/useUnsavedChangesPrompt";
import { useUrlQueryState } from "@/hooks/useUrlQueryState";
import { api, type GarminStatus, QUERY_KEYS, type StravaStatus, type UserPreferences } from "@/lib/api";
import { getUserDisplayName } from "@/lib/authUtils";
import { queryClient } from "@/lib/queryClient";

type Preferences = UserPreferences;

// Tab ids double as the `?tab=` deep-link value. `account` is the default
// landing tab (omitted from the URL by useUrlQueryState).
const SETTINGS_TABS = ["account", "training", "integrations", "notifications", "data"] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

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
type ActivityLevelValue = "sedentary" | "light" | "moderate" | "active" | "very_active";
type WeightGoalDirectionValue = "lose" | "maintain" | "gain";

type SavePayload = Omit<UserPreferences, "weeklyGoal" | "userTimezone"> & { weeklyGoal: number };
interface PreferencesSnapshot
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

function ageInputToSnapshot(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function mafHrDataAvailableInputToSnapshot(value: MafHrDataAvailableInput): boolean | null {
  if (!value) {
    return null;
  }
  return value === "yes";
}

function mafHrDataAvailableToInput(value: boolean | null | undefined): MafHrDataAvailableInput {
  if (value == null) {
    return "";
  }
  return value ? "yes" : "no";
}

function preferencesToSnapshot(preferences: Preferences): PreferencesSnapshot {
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
    mealSchedule: (preferences.mealSchedule ?? 4),
    emailNotifications: preferences.emailNotifications ?? false,
    emailWeeklySummary: preferences.emailWeeklySummary ?? false,
    emailMissedReminder: preferences.emailMissedReminder ?? false,
    showAdherenceInsights: preferences.showAdherenceInsights ?? true,
    aiCoachEnabled: preferences.aiCoachEnabled ?? false,
    trainingStyleId: preferences.trainingStyleId ?? "balanced_default",
    mafAge: preferences.mafAge ?? null,
    mafConsistency: preferences.mafConsistency ?? null,
    mafTrend: preferences.mafTrend ?? null,
    mafHrDataAvailable: preferences.mafHrDataAvailable ?? null,
  };
}

function savePayloadToSnapshot(payload: SavePayload): PreferencesSnapshot {
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
    mealSchedule: (payload.mealSchedule ?? 4),
    emailNotifications: payload.emailNotifications,
    emailWeeklySummary: payload.emailWeeklySummary,
    emailMissedReminder: payload.emailMissedReminder,
    showAdherenceInsights: payload.showAdherenceInsights,
    aiCoachEnabled: payload.aiCoachEnabled,
    trainingStyleId: payload.trainingStyleId ?? "balanced_default",
    mafAge: payload.mafAge ?? null,
    mafConsistency: payload.mafConsistency ?? null,
    mafTrend: payload.mafTrend ?? null,
    mafHrDataAvailable: payload.mafHrDataAvailable ?? null,
  };
}

function snapshotToSavePayload(snapshot: PreferencesSnapshot): SavePayload {
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
    trainingStyleId: snapshot.trainingStyleId,
    mafAge: snapshot.mafAge,
    mafConsistency: snapshot.mafConsistency,
    mafTrend: snapshot.mafTrend,
    mafHrDataAvailable: snapshot.mafHrDataAvailable,
  };
}

export default function Settings() {
  useDocumentTitle("Settings");
  const { toast } = useToast();
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const [activeTab, setActiveTab] = useUrlQueryState<SettingsTab>("tab", "account", SETTINGS_TABS);
  const [weightUnit, setWeightUnit] = useState("kg");
  const [distanceUnit, setDistanceUnit] = useState("km");
  const [division, setDivision] = useState("open");
  const [gender, setGender] = useState("prefer_not_to_say");
  const [ageInput, setAgeInput] = useState("");
  const [bodyweightKg, setBodyweightKg] = useState<number | null>(null);
  const [heightCm, setHeightCm] = useState<number | null>(null);
  const [restingHrInput, setRestingHrInput] = useState("");
  const [maxHrInput, setMaxHrInput] = useState("");
  const [ftpInput, setFtpInput] = useState("");
  const [activityLevel, setActivityLevel] = useState("");
  const [weightGoalDirection, setWeightGoalDirection] = useState("");
  const [weightGoalRateKgPerWeek, setWeightGoalRateKgPerWeek] = useState<number | null>(null);
  const [weeklyGoal, setWeeklyGoal] = useState("5");
  const [mealSchedule, setMealSchedule] = useState<3 | 4 | 5>(4);
  const [emailNotifications, setEmailNotifications] = useState(false);
  const [emailWeeklySummary, setEmailWeeklySummary] = useState(false);
  const [emailMissedReminder, setEmailMissedReminder] = useState(false);
  const [showAdherenceInsights, setShowAdherenceInsights] = useState(true);
  const [aiCoachEnabled, setAiCoachEnabled] = useState(false);
  const [trainingStyleId, setTrainingStyleId] = useState("balanced_default");
  const [hasChanges, setHasChanges] = useState(false);
  const [mafAgeInput, setMafAgeInput] = useState("");
  const [mafConsistencyInput, setMafConsistencyInput] = useState<MafConsistencyInput>("");
  const [mafTrendInput, setMafTrendInput] = useState<MafTrendInput>("");
  const [mafHrDataAvailableInput, setMafHrDataAvailableInput] =
    useState<MafHrDataAvailableInput>("");
  const [styleAuditEntries, setStyleAuditEntries] = useState<StyleAuditEntry[]>(() => {
    try {
      const raw = localStorage.getItem("fitai-settings-style-audit");
      if (!raw) return [];
      const parsed = JSON.parse(raw) as StyleAuditEntry[];
      return Array.isArray(parsed) ? parsed.slice(0, 10) : [];
    } catch {
      return [];
    }
  });
  // Snapshot of initial local defaults. Used as a fallback baseline if
  // remote preferences never load (e.g. query error) so edits can still
  // surface the sticky save bar.
  const defaultSnapshotRef = useRef<PreferencesSnapshot>({
    weightUnit: "kg",
    distanceUnit: "km",
    division: "open",
    gender: "prefer_not_to_say",
    age: null,
    bodyweightKg: null,
    heightCm: null,
    restingHr: null,
    maxHr: null,
    ftp: null,
    activityLevel: null,
    weightGoalDirection: null,
    weightGoalRateKgPerWeek: null,
    weeklyGoal: "5",
    mealSchedule: 4,
    emailNotifications: false,
    emailWeeklySummary: false,
    emailMissedReminder: false,
    showAdherenceInsights: true,
    aiCoachEnabled: false,
    trainingStyleId: "balanced_default",
    mafAge: null,
    mafConsistency: null,
    mafTrend: null,
    mafHrDataAvailable: null,
  });
  // Snapshot of the last server-committed values used as the baseline for
  // dirty-state computation.
  const baselineSnapshotRef = useRef<PreferencesSnapshot | null>(null);
  // Snapshot of values before the most recent save, used to offer an
  // "Undo" action on the post-save toast.
  const undoSnapshotRef = useRef<PreferencesSnapshot | null>(null);
  const pendingStyleAuditRef = useRef<StyleAuditEntry | null>(null);
  const settingsSearchPath = search ? `?${search}` : "";
  const currentSettingsPath = `${location}${settingsSearchPath}`;
  const unsavedChangesPrompt = useUnsavedChangesPrompt({
    enabled: hasChanges,
    currentPath: currentSettingsPath,
    navigate: setLocation,
  });

  const currentSnapshot = useCallback(
    (): PreferencesSnapshot => ({
      weightUnit,
      distanceUnit,
      division,
      gender,
      age: ageInputToSnapshot(ageInput),
      bodyweightKg,
      heightCm,
      restingHr: ageInputToSnapshot(restingHrInput),
      maxHr: ageInputToSnapshot(maxHrInput),
      ftp: ageInputToSnapshot(ftpInput),
      activityLevel: (activityLevel || null) as ActivityLevelValue | null,
      weightGoalDirection: (weightGoalDirection || null) as WeightGoalDirectionValue | null,
      weightGoalRateKgPerWeek,
      weeklyGoal,
      mealSchedule,
      emailNotifications,
      emailWeeklySummary,
      emailMissedReminder,
      showAdherenceInsights,
      aiCoachEnabled,
      trainingStyleId,
      mafAge: ageInputToSnapshot(mafAgeInput),
      mafConsistency: mafConsistencyInput || null,
      mafTrend: mafTrendInput || null,
      mafHrDataAvailable: mafHrDataAvailableInputToSnapshot(mafHrDataAvailableInput),
    }),
    [
      weightUnit,
      distanceUnit,
      division,
      gender,
      bodyweightKg,
      heightCm,
      restingHrInput,
      maxHrInput,
      ftpInput,
      activityLevel,
      weightGoalDirection,
      weightGoalRateKgPerWeek,
      weeklyGoal,
      mealSchedule,
      emailNotifications,
      emailWeeklySummary,
      emailMissedReminder,
      showAdherenceInsights,
      aiCoachEnabled,
      trainingStyleId,
      ageInput,
      mafAgeInput,
      mafConsistencyInput,
      mafTrendInput,
      mafHrDataAvailableInput,
    ],
  );

  useEffect(() => {
    const params = new URLSearchParams(search);
    const stravaResult = params.get("strava");
    if (stravaResult !== "connected" && stravaResult !== "error") {
      return;
    }
    if (stravaResult === "connected") {
      toast({
        title: "Strava Connected",
        description: "Your Strava account has been successfully connected.",
      });
    } else {
      toast({
        title: "Connection Failed",
        description: "Failed to connect to Strava. Please try again.",
        variant: "destructive",
      });
    }
    // Land the user on the Integrations tab and clear the `strava` callback
    // param. setActiveTab syncs the hook/Tabs state; setLocation strips the
    // param from the URL (the tab is preserved via the query string).
    setActiveTab("integrations");
    setLocation("/settings?tab=integrations", { replace: true });
  }, [search, toast, setLocation, setActiveTab]);

  const {
    data: preferences,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery<Preferences>({
    queryKey: QUERY_KEYS.preferences,
  });

  const { data: stravaStatus, isLoading: stravaLoading } =
    useQuery<StravaStatus>({
      queryKey: QUERY_KEYS.stravaStatus,
    });

  const { data: garminStatus, isLoading: garminLoading } =
    useQuery<GarminStatus>({
      queryKey: QUERY_KEYS.garminStatus,
    });

  useEffect(() => {
    if (preferences) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWeightUnit(preferences.weightUnit || "kg");
      setDistanceUnit(preferences.distanceUnit || "km");
      setDivision(preferences.division || "open");
      setGender(preferences.gender ?? "prefer_not_to_say");
      setAgeInput(preferences.age == null ? "" : String(preferences.age));
      setBodyweightKg(preferences.bodyweightKg ?? null);
      setHeightCm(preferences.heightCm ?? null);
      setRestingHrInput(preferences.restingHr == null ? "" : String(preferences.restingHr));
      setMaxHrInput(preferences.maxHr == null ? "" : String(preferences.maxHr));
      setFtpInput(preferences.ftp == null ? "" : String(preferences.ftp));
      setActivityLevel(preferences.activityLevel ?? "");
      setWeightGoalDirection(preferences.weightGoalDirection ?? "");
      setWeightGoalRateKgPerWeek(preferences.weightGoalRateKgPerWeek ?? null);
      setWeeklyGoal(String(preferences.weeklyGoal || 5));
      setMealSchedule((preferences.mealSchedule ?? 4));
      setEmailNotifications(preferences.emailNotifications ?? false);
      setEmailWeeklySummary(preferences.emailWeeklySummary ?? false);
      setEmailMissedReminder(preferences.emailMissedReminder ?? false);
      setShowAdherenceInsights(preferences.showAdherenceInsights ?? true);
      setAiCoachEnabled(preferences.aiCoachEnabled ?? false);
      setTrainingStyleId(preferences.trainingStyleId ?? "balanced_default");
      setMafAgeInput(preferences.mafAge == null ? "" : String(preferences.mafAge));
      setMafConsistencyInput(preferences.mafConsistency ?? "");
      setMafTrendInput(preferences.mafTrend ?? "");
      setMafHrDataAvailableInput(mafHrDataAvailableToInput(preferences.mafHrDataAvailable));
      // Seed the baseline snapshot on first load. After saves, onSuccess
      // keeps the baseline in sync with committed values.
      if (!baselineSnapshotRef.current) {
        baselineSnapshotRef.current = preferencesToSnapshot(preferences);
      }
    }
  }, [preferences]);

  useEffect(() => {
    const baseline = baselineSnapshotRef.current ?? defaultSnapshotRef.current;
    setHasChanges(JSON.stringify(currentSnapshot()) !== JSON.stringify(baseline));
  }, [currentSnapshot]);

  const saveMutation = useMutation({
    mutationFn: (data: SavePayload) => api.preferences.update(data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.preferences }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.authUser }).catch(() => {});
      // Promote the saved values to the dirty-state baseline so we don't
      // depend on the invalidating preferences query timing.
      baselineSnapshotRef.current = savePayloadToSnapshot(variables);
      setHasChanges(false);
      if (pendingStyleAuditRef.current) {
        const nextAudit = [pendingStyleAuditRef.current, ...styleAuditEntries].slice(0, 10);
        setStyleAuditEntries(nextAudit);
        localStorage.setItem("fitai-settings-style-audit", JSON.stringify(nextAudit));
        pendingStyleAuditRef.current = null;
      }
      const previous = undoSnapshotRef.current;
      toast({
        title: "Settings saved",
        description: "Your preferences have been updated.",
        action: previous ? (
          <ToastAction
            altText="Undo settings change"
            data-testid="button-undo-settings"
            onClick={() => {
              // Restore the previous values in-state and persist them.
              // Leave undoSnapshotRef in place so a second undo restores
              // again — the mutation onSuccess will replace it after
              // persistence completes.
              setWeightUnit(previous.weightUnit);
              setDistanceUnit(previous.distanceUnit);
              setDivision(previous.division);
              setGender(previous.gender);
              setBodyweightKg(previous.bodyweightKg);
              setHeightCm(previous.heightCm);
              setRestingHrInput(previous.restingHr == null ? "" : String(previous.restingHr));
              setMaxHrInput(previous.maxHr == null ? "" : String(previous.maxHr));
              setFtpInput(previous.ftp == null ? "" : String(previous.ftp));
              setActivityLevel(previous.activityLevel ?? "");
              setWeightGoalDirection(previous.weightGoalDirection ?? "");
              setWeightGoalRateKgPerWeek(previous.weightGoalRateKgPerWeek);
              setWeeklyGoal(previous.weeklyGoal);
              setMealSchedule(previous.mealSchedule);
              setEmailNotifications(previous.emailNotifications);
              setEmailWeeklySummary(previous.emailWeeklySummary);
              setEmailMissedReminder(previous.emailMissedReminder);
              setShowAdherenceInsights(previous.showAdherenceInsights);
              setAiCoachEnabled(previous.aiCoachEnabled);
              setTrainingStyleId(previous.trainingStyleId);
              setMafAgeInput(previous.mafAge == null ? "" : String(previous.mafAge));
              setMafConsistencyInput(previous.mafConsistency ?? "");
              setMafTrendInput(previous.mafTrend ?? "");
              setMafHrDataAvailableInput(mafHrDataAvailableToInput(previous.mafHrDataAvailable));
              saveMutation.mutate(snapshotToSavePayload(previous));
            }}
          >
            Undo
          </ToastAction>
        ) : undefined,
      });
    },
    onError: () => {
      pendingStyleAuditRef.current = null;
      toast({
        title: "Error",
        description: "Failed to save settings. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Warn user before leaving with unsaved changes
  useEffect(() => {
    if (!hasChanges) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    globalThis.window.addEventListener("beforeunload", handler);
    return () => globalThis.window.removeEventListener("beforeunload", handler);
  }, [hasChanges]);

  const handleSave = useCallback(() => {
    const mafAge = ageInputToSnapshot(mafAgeInput);
    const mafConsistency = mafConsistencyInput || null;
    const mafTrend = mafTrendInput || null;
    const mafHrDataAvailable = mafHrDataAvailableInputToSnapshot(mafHrDataAvailableInput);
    const hasValidMafInputs =
      mafAge != null && mafAge >= 16 && mafAge <= 99 && Boolean(mafConsistency) && Boolean(mafTrend);

    if (trainingStyleId === "maf_method" && !hasValidMafInputs) {
      toast({
        title: "Complete MAF setup",
        description: "Enter a valid age and select the required MAF fields before saving.",
        variant: "destructive",
      });
      return;
    }

    // Capture the pre-save baseline so the post-save toast can offer Undo.
    undoSnapshotRef.current = baselineSnapshotRef.current
      ? { ...baselineSnapshotRef.current }
      : null;
    const committedStyleId = baselineSnapshotRef.current?.trainingStyleId ?? "balanced_default";
    const styleChanged = trainingStyleId !== committedStyleId;
    const maf = trainingStyleId === "maf_method" && hasValidMafInputs ? calculateMafHr({
      age: mafAge,
      injuryIllnessMedication: Boolean(preferences?.mafInjuryIllnessMedication),
      consistency: mafConsistency!,
      trend: mafTrend!,
    }) : null;
    pendingStyleAuditRef.current = styleChanged
      ? {
          changedAtIso: new Date().toISOString(),
          fromStyleId: committedStyleId,
          toStyleId: trainingStyleId,
          recalculations: buildRecalculationSummary(trainingStyleId),
        }
      : null;
    saveMutation.mutate({
      weightUnit,
      distanceUnit,
      division,
      gender,
      age: ageInputToSnapshot(ageInput),
      bodyweightKg,
      heightCm,
      restingHr: ageInputToSnapshot(restingHrInput),
      maxHr: ageInputToSnapshot(maxHrInput),
      ftp: ageInputToSnapshot(ftpInput),
      activityLevel: (activityLevel || null) as ActivityLevelValue | null,
      weightGoalDirection: (weightGoalDirection || null) as WeightGoalDirectionValue | null,
      weightGoalRateKgPerWeek,
      weeklyGoal: Number.parseInt(weeklyGoal, 10),
      mealSchedule,
      emailNotifications,
      emailWeeklySummary,
      emailMissedReminder,
      showAdherenceInsights,
      aiCoachEnabled,
      trainingStyleId,
      trainingStylePreviousId: styleChanged ? committedStyleId : undefined,
      trainingStyleChangedAt: styleChanged ? new Date().toISOString() : undefined,
      trainingStyleRecomputeNow: styleChanged,
      mafAge,
      mafConsistency,
      mafTrend,
      mafHrDataAvailable,
      mafHr: trainingStyleId === "maf_method" ? maf?.ceiling : undefined,
      mafBaselineTestScheduledAt: styleChanged && trainingStyleId === "maf_method" ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() : undefined,
    });
  }, [
    saveMutation,
    weightUnit,
    distanceUnit,
    division,
    gender,
    ageInput,
    bodyweightKg,
    heightCm,
    restingHrInput,
    maxHrInput,
    ftpInput,
    activityLevel,
    weightGoalDirection,
    weightGoalRateKgPerWeek,
    weeklyGoal,
    mealSchedule,
    emailNotifications,
    emailWeeklySummary,
    emailMissedReminder,
    showAdherenceInsights,
    aiCoachEnabled,
    trainingStyleId,
    mafAgeInput,
    mafConsistencyInput,
    mafTrendInput,
    mafHrDataAvailableInput,
    preferences?.mafInjuryIllnessMedication,
    toast,
  ]);

  const userName = getUserDisplayName(user);
  const hasRequiredMafInputs = useCallback(() => {
    const age = ageInputToSnapshot(mafAgeInput);
    return (
      age != null &&
      age >= 16 &&
      age <= 99 &&
      Boolean(mafConsistencyInput) &&
      Boolean(mafTrendInput)
    );
  }, [mafAgeInput, mafConsistencyInput, mafTrendInput]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner label="Loading settings" />
      </div>
    );
  }

  if (isError && !preferences) {
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";

    return (
      <PageContainer size="narrow">
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive">Couldn't load settings</CardTitle>
            <CardDescription>
              We couldn't load your preferences right now. Please try again.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Raw error text is dev-only — the CardDescription above carries the
                user-facing message. Surfacing `error.message` (e.g. "500: …") in
                production is confusing and can leak internals (matches
                FallbackErrorBoundary's NODE_ENV gate). */}
            {import.meta.env.DEV && (
              <p className="text-sm text-muted-foreground">{errorMessage}</p>
            )}
            <Button onClick={() => refetch()} disabled={isFetching} data-testid="button-retry-load-settings">
              {isFetching ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
              ) : (
                <RotateCw className="h-4 w-4 mr-2" aria-hidden="true" />
              )}
              {isFetching ? "Retrying…" : "Retry"}
            </Button>
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer size="narrow" className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage your account and preferences
        </p>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(value as SettingsTab);
        }}
        className="w-full"
      >
        <TabsList className="mb-6 grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-5 sm:gap-0">
          <TabsTrigger value="account" data-testid="tab-account">
            <User className="h-4 w-4 mr-2" aria-hidden="true" />
            Account
          </TabsTrigger>
          <TabsTrigger value="training" data-testid="tab-training">
            <Dumbbell className="h-4 w-4 mr-2" aria-hidden="true" />
            Training
          </TabsTrigger>
          <TabsTrigger value="integrations" data-testid="tab-integrations">
            <Link2 className="h-4 w-4 mr-2" aria-hidden="true" />
            Integrations
          </TabsTrigger>
          <TabsTrigger value="notifications" data-testid="tab-notifications">
            <Bell className="h-4 w-4 mr-2" aria-hidden="true" />
            Notifications
          </TabsTrigger>
          <TabsTrigger
            value="data"
            data-testid="tab-data"
            className="col-span-2 sm:col-span-1"
          >
            <Database className="h-4 w-4 mr-2" aria-hidden="true" />
            Data &amp; Privacy
          </TabsTrigger>
        </TabsList>

        <TabsContent value="account" className="space-y-6">
          <ProfileSection userName={userName} />
          <UnitsPreferencesCard
            weightUnit={weightUnit}
            distanceUnit={distanceUnit}
            onWeightUnitChange={(v) => {
              setWeightUnit(v);
            }}
            onDistanceUnitChange={(v) => {
              setDistanceUnit(v);
            }}
          />
          <Card>
            <CardHeader>
              <CardTitle>Getting Started</CardTitle>
              <CardDescription>
                Run the welcome flow again if you skipped it or want to pick a different training plan.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                data-testid="button-rerun-onboarding"
                onClick={() => {
                  unsavedChangesPrompt.requestNavigation(
                    "/?onboarding=run",
                    undefined,
                    clearLocalOnboardingComplete,
                  );
                }}
              >
                <RotateCw className="h-4 w-4 mr-2" aria-hidden="true" />
                Run setup again
              </Button>
            </CardContent>
          </Card>
          <AccountDangerZone />
        </TabsContent>

        <TabsContent value="training" className="space-y-6">
          <AthleteProfileCard
            division={division}
            gender={gender}
            age={ageInput}
            onDivisionChange={setDivision}
            onGenderChange={setGender}
            onAgeChange={setAgeInput}
          />
          <BodyCompositionCard
            weightUnit={weightUnit}
            bodyweightKg={bodyweightKg}
            heightCm={heightCm}
            activityLevel={activityLevel}
            weightGoalDirection={weightGoalDirection}
            weightGoalRateKgPerWeek={weightGoalRateKgPerWeek}
            onBodyweightKgChange={setBodyweightKg}
            onHeightCmChange={setHeightCm}
            onActivityLevelChange={setActivityLevel}
            onWeightGoalDirectionChange={setWeightGoalDirection}
            onWeightGoalRateKgPerWeekChange={setWeightGoalRateKgPerWeek}
          />
          <HealthMetricsCard
            restingHr={restingHrInput}
            maxHr={maxHrInput}
            ftp={ftpInput}
            onRestingHrChange={setRestingHrInput}
            onMaxHrChange={setMaxHrInput}
            onFtpChange={setFtpInput}
          />
          <NutritionPreferencesCard
            mealSchedule={mealSchedule}
            onMealScheduleChange={setMealSchedule}
          />
          <TrainingGoalsCard
            weeklyGoal={weeklyGoal}
            onWeeklyGoalChange={(v) => {
              setWeeklyGoal(v);
            }}
          />
          <TrainingStyleSection
            trainingStyleId={trainingStyleId}
            onTrainingStyleIdChange={setTrainingStyleId}
            hasRequiredMafInputs={hasRequiredMafInputs()}
            mafAgeInput={mafAgeInput}
            mafConsistencyInput={mafConsistencyInput}
            mafTrendInput={mafTrendInput}
            mafHrDataAvailableInput={mafHrDataAvailableInput}
            onMafAgeInputChange={setMafAgeInput}
            onMafConsistencyInputChange={setMafConsistencyInput}
            onMafTrendInputChange={setMafTrendInput}
            onMafHrDataAvailableInputChange={setMafHrDataAvailableInput}
            styleAuditEntries={styleAuditEntries}
          />
          <WorkoutReviewCard
            showAdherenceInsights={showAdherenceInsights}
            onShowAdherenceInsightsChange={(v) => {
              setShowAdherenceInsights(v);
            }}
          />
          <AiCoachCard
            aiCoachEnabled={aiCoachEnabled}
            onAiCoachEnabledChange={(v) => {
              setAiCoachEnabled(v);
            }}
          />
          <CoachingSection />
        </TabsContent>

        <TabsContent value="integrations" className="space-y-6">
          <StravaSection stravaStatus={stravaStatus} stravaLoading={stravaLoading} />
          <GarminSection garminStatus={garminStatus} garminLoading={garminLoading} />
        </TabsContent>

        <TabsContent value="notifications" className="space-y-6">
          <EmailNotificationsCard
            emailNotifications={emailNotifications}
            emailWeeklySummary={emailWeeklySummary}
            emailMissedReminder={emailMissedReminder}
            onEmailNotificationsChange={(v) => {
              setEmailNotifications(v);
            }}
            onEmailWeeklySummaryChange={(v) => {
              setEmailWeeklySummary(v);
            }}
            onEmailMissedReminderChange={(v) => {
              setEmailMissedReminder(v);
            }}
          />
          <PushNotificationSection />
        </TabsContent>

        <TabsContent value="data" className="space-y-6">
          <DataToolsSection />
        </TabsContent>
      </Tabs>

      {hasChanges && (
        <div className="sticky bottom-0 -mx-4 md:-mx-8 px-4 md:px-8 py-3 border-t bg-background/95 backdrop-blur z-40">
          <Button
            onClick={handleSave}
            className="w-full"
            data-testid="button-save-settings"
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" />
                Saving...
              </>
            ) : (
              "Save Settings"
            )}
          </Button>
        </div>
      )}

      <AlertDialog
        open={unsavedChangesPrompt.isPromptOpen}
        onOpenChange={(open) => {
          if (!open) {
            unsavedChangesPrompt.cancelNavigation();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved settings changes. Discard them and leave Settings?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={unsavedChangesPrompt.cancelNavigation}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={unsavedChangesPrompt.discardChangesAndNavigate}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
