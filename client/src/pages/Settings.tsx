import { calculateMafHr } from "@shared/maf";
import { useMutation,useQuery } from "@tanstack/react-query";
import { Loader2, RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";

import { AccountDangerZone } from "@/components/settings/AccountDangerZone";
import { CoachingSection } from "@/components/settings/CoachingSection";
import { DataToolsSection } from "@/components/settings/DataToolsSection";
import { GarminSection } from "@/components/settings/GarminSection";
import { PreferencesSection } from "@/components/settings/PreferencesSection";
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
import { ToastAction } from "@/components/ui/toast";
import { clearLocalOnboardingComplete } from "@/hooks/onboardingStorage";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useUnsavedChangesPrompt } from "@/hooks/useUnsavedChangesPrompt";
import { api, type GarminStatus, QUERY_KEYS, type StravaStatus, type UserPreferences } from "@/lib/api";
import { getUserDisplayName } from "@/lib/authUtils";
import { queryClient } from "@/lib/queryClient";

type Preferences = UserPreferences;

// The save mutation sends weeklyGoal as a number; local form state stores
// it as a string so the <Input type="number"> can hold a partially-typed
// value. `PreferencesSnapshot` captures the form-state shape (weeklyGoal as
// string) used for Undo + committed-state tracking.
type SavePayload = Omit<UserPreferences, "weeklyGoal"> & { weeklyGoal: number };
interface PreferencesSnapshot
  extends Omit<
    UserPreferences,
    "weeklyGoal" | "trainingStyleId" | "mafAge" | "mafConsistency" | "mafTrend" | "mafHrDataAvailable"
  > {
  weeklyGoal: string;
  trainingStyleId: string;
  mafAge: number | null;
  mafConsistency: Exclude<MafConsistencyInput, ""> | null;
  mafTrend: Exclude<MafTrendInput, ""> | null;
  mafHrDataAvailable: boolean | null;
}

function mafAgeInputToSnapshot(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function mafHrDataAvailableInputToSnapshot(value: MafHrDataAvailableInput): boolean | null {
  if (!value) {
    return null;
  }
  return value === "yes";
}

function preferencesToSnapshot(preferences: Preferences): PreferencesSnapshot {
  return {
    weightUnit: preferences.weightUnit || "kg",
    distanceUnit: preferences.distanceUnit || "km",
    weeklyGoal: String(preferences.weeklyGoal || 5),
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
    weeklyGoal: String(payload.weeklyGoal),
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
    weeklyGoal: Number.parseInt(snapshot.weeklyGoal, 10),
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
  const { toast } = useToast();
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const [weightUnit, setWeightUnit] = useState("kg");
  const [distanceUnit, setDistanceUnit] = useState("km");
  const [weeklyGoal, setWeeklyGoal] = useState("5");
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
    weeklyGoal: "5",
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
  const currentSettingsPath = `${location}${search ? `?${search}` : ""}`;
  const unsavedChangesPrompt = useUnsavedChangesPrompt({
    enabled: hasChanges,
    currentPath: currentSettingsPath,
    navigate: setLocation,
  });

  const currentSnapshot = useCallback(
    (): PreferencesSnapshot => ({
      weightUnit,
      distanceUnit,
      weeklyGoal,
      emailNotifications,
      emailWeeklySummary,
      emailMissedReminder,
      showAdherenceInsights,
      aiCoachEnabled,
      trainingStyleId,
      mafAge: mafAgeInputToSnapshot(mafAgeInput),
      mafConsistency: mafConsistencyInput || null,
      mafTrend: mafTrendInput || null,
      mafHrDataAvailable: mafHrDataAvailableInputToSnapshot(mafHrDataAvailableInput),
    }),
    [
      weightUnit,
      distanceUnit,
      weeklyGoal,
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
    ],
  );

  useEffect(() => {
    const params = new URLSearchParams(search);
    const stravaStatus = params.get("strava");
    if (stravaStatus === "connected") {
      toast({
        title: "Strava Connected",
        description: "Your Strava account has been successfully connected.",
      });
      setLocation("/settings", { replace: true });
    } else if (stravaStatus === "error") {
      toast({
        title: "Connection Failed",
        description: "Failed to connect to Strava. Please try again.",
        variant: "destructive",
      });
      setLocation("/settings", { replace: true });
    }
  }, [search, toast, setLocation]);

  const {
    data: preferences,
    isLoading,
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
      setWeeklyGoal(String(preferences.weeklyGoal || 5));
      setEmailNotifications(preferences.emailNotifications ?? false);
      setEmailWeeklySummary(preferences.emailWeeklySummary ?? false);
      setEmailMissedReminder(preferences.emailMissedReminder ?? false);
      setShowAdherenceInsights(preferences.showAdherenceInsights ?? true);
      setAiCoachEnabled(preferences.aiCoachEnabled ?? false);
      setTrainingStyleId(preferences.trainingStyleId ?? "balanced_default");
      setMafAgeInput(preferences.mafAge != null ? String(preferences.mafAge) : "");
      setMafConsistencyInput(preferences.mafConsistency ?? "");
      setMafTrendInput(preferences.mafTrend ?? "");
      setMafHrDataAvailableInput(
        preferences.mafHrDataAvailable == null
          ? ""
          : preferences.mafHrDataAvailable
            ? "yes"
            : "no",
      );
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
              setWeeklyGoal(previous.weeklyGoal);
              setEmailNotifications(previous.emailNotifications);
              setEmailWeeklySummary(previous.emailWeeklySummary);
              setEmailMissedReminder(previous.emailMissedReminder);
              setShowAdherenceInsights(previous.showAdherenceInsights);
              setAiCoachEnabled(previous.aiCoachEnabled);
              setTrainingStyleId(previous.trainingStyleId);
              setMafAgeInput(previous.mafAge != null ? String(previous.mafAge) : "");
              setMafConsistencyInput(previous.mafConsistency ?? "");
              setMafTrendInput(previous.mafTrend ?? "");
              setMafHrDataAvailableInput(
                previous.mafHrDataAvailable == null
                  ? ""
                  : previous.mafHrDataAvailable
                    ? "yes"
                    : "no",
              );
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
    const mafAge = mafAgeInputToSnapshot(mafAgeInput);
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
      weeklyGoal: Number.parseInt(weeklyGoal, 10),
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
    weeklyGoal,
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
    const age = mafAgeInputToSnapshot(mafAgeInput);
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
            <p className="text-sm text-muted-foreground">{errorMessage}</p>
            <Button onClick={() => refetch()} data-testid="button-retry-load-settings">
              Retry
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

      <ProfileSection userName={userName} />

      <StravaSection
        stravaStatus={stravaStatus}
        stravaLoading={stravaLoading}
      />

      <GarminSection
        garminStatus={garminStatus}
        garminLoading={garminLoading}
      />

      <PreferencesSection
        weightUnit={weightUnit}
        distanceUnit={distanceUnit}
        weeklyGoal={weeklyGoal}
        emailNotifications={emailNotifications}
        emailWeeklySummary={emailWeeklySummary}
        emailMissedReminder={emailMissedReminder}
        showAdherenceInsights={showAdherenceInsights}
        aiCoachEnabled={aiCoachEnabled}
        onWeightUnitChange={(v) => {
          setWeightUnit(v);
        }}
        onDistanceUnitChange={(v) => {
          setDistanceUnit(v);
        }}
        onWeeklyGoalChange={(v) => {
          setWeeklyGoal(v);
        }}
        onEmailNotificationsChange={(v) => {
          setEmailNotifications(v);
        }}
        onEmailWeeklySummaryChange={(v) => {
          setEmailWeeklySummary(v);
        }}
        onEmailMissedReminderChange={(v) => {
          setEmailMissedReminder(v);
        }}
        onShowAdherenceInsightsChange={(v) => {
          setShowAdherenceInsights(v);
        }}
        onAiCoachEnabledChange={(v) => {
          setAiCoachEnabled(v);
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
      <PushNotificationSection />

      <CoachingSection />

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

      <DataToolsSection />

      <AccountDangerZone />

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
