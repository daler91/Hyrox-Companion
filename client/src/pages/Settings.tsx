import { calculateMafHr } from "@shared/maf";
import { useMutation,useQuery } from "@tanstack/react-query";
import { Info, Loader2, RotateCw } from "lucide-react";
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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToastAction } from "@/components/ui/toast";
import { clearLocalOnboardingComplete } from "@/hooks/onboardingStorage";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { api, type GarminStatus, QUERY_KEYS, type StravaStatus, type UserPreferences } from "@/lib/api";
import { getUserDisplayName } from "@/lib/authUtils";
import { queryClient } from "@/lib/queryClient";

// Local alias so callsites that refer to `Preferences` still read naturally.
// Shape is maintained by the api/user.ts export contract.
interface StyleAuditEntry {
  changedAtIso: string;
  fromStyleId: string;
  toStyleId: string;
  recalculations: string[];
}

const STYLE_LABELS: Record<string, string> = {
  balanced_default: "Balanced",
  maf_method: "MAF Method",
};

function getStyleLabel(styleId: string): string {
  return STYLE_LABELS[styleId] ?? "Balanced";
}

function buildRecalculationSummary(styleId: string): string[] {
  const summary = [
    "Coach recommendation prompt context switched to the selected style.",
    "Future plan generation uses the updated style constraints.",
    "Training-style recompute flag set for downstream AI calculations.",
  ];
  if (styleId === "maf_method") {
    summary.push("MAF heart-rate ceiling recomputed and baseline test reminder scheduled.");
  }
  return summary;
}

type Preferences = UserPreferences;

// The save mutation sends weeklyGoal as a number; local form state stores
// it as a string so the <Input type="number"> can hold a partially-typed
// value. `PreferencesSnapshot` captures the form-state shape (weeklyGoal as
// string) used for Undo + committed-state tracking.
type SavePayload = Omit<UserPreferences, "weeklyGoal"> & { weeklyGoal: number };
interface PreferencesSnapshot extends Omit<UserPreferences, "weeklyGoal"> {
  weeklyGoal: string;
  trainingStyleId: string;
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
  };
}

export default function Settings() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
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
  const [confirmStyleOpen, setConfirmStyleOpen] = useState(false);
  const [pendingStyleId, setPendingStyleId] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [styleTransitionNotice, setStyleTransitionNotice] = useState<string | null>(null);
  const [styleSwitchBlockedMessage, setStyleSwitchBlockedMessage] = useState<string | null>(null);
  const [mafSetupOpen, setMafSetupOpen] = useState(false);
  const [mafAgeInput, setMafAgeInput] = useState("");
  const [mafConsistencyInput, setMafConsistencyInput] = useState<"" | "low" | "moderate" | "high">("");
  const [mafTrendInput, setMafTrendInput] = useState<"" | "improving" | "flat" | "declining">("");
  const [mafHrDataAvailableInput, setMafHrDataAvailableInput] = useState<"" | "yes" | "no">("");
  const [mafSetupError, setMafSetupError] = useState<string | null>(null);
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
  });
  // Snapshot of the last server-committed values used as the baseline for
  // dirty-state computation.
  const baselineSnapshotRef = useRef<PreferencesSnapshot | null>(null);
  // Snapshot of values before the most recent save, used to offer an
  // "Undo" action on the post-save toast.
  const undoSnapshotRef = useRef<PreferencesSnapshot | null>(null);
  const pendingStyleAuditRef = useRef<StyleAuditEntry | null>(null);

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
    }),
    [weightUnit, distanceUnit, weeklyGoal, emailNotifications, emailWeeklySummary, emailMissedReminder, showAdherenceInsights, aiCoachEnabled, trainingStyleId],
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
    // Capture the pre-save baseline so the post-save toast can offer Undo.
    undoSnapshotRef.current = baselineSnapshotRef.current
      ? { ...baselineSnapshotRef.current }
      : null;
    const committedStyleId = baselineSnapshotRef.current?.trainingStyleId ?? "balanced_default";
    const styleChanged = trainingStyleId !== committedStyleId;
    const maf = trainingStyleId === "maf_method" ? calculateMafHr({
      age: Number(preferences?.mafAge ?? 35),
      injuryIllnessMedication: Boolean(preferences?.mafInjuryIllnessMedication),
      consistency: (preferences?.mafConsistency as "low" | "moderate" | "high") ?? "moderate",
      trend: (preferences?.mafTrend as "improving" | "flat" | "declining") ?? "flat",
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
      mafHr: styleChanged && trainingStyleId === "maf_method" ? maf?.ceiling : undefined,
      mafBaselineTestScheduledAt: styleChanged && trainingStyleId === "maf_method" ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() : undefined,
    });
  }, [saveMutation, weightUnit, distanceUnit, weeklyGoal, emailNotifications, emailWeeklySummary, emailMissedReminder, showAdherenceInsights, aiCoachEnabled, trainingStyleId, preferences?.mafAge, preferences?.mafInjuryIllnessMedication, preferences?.mafConsistency, preferences?.mafTrend]);
  const stageSaveAuditState = useCallback((nextStyleId: string) => {
    undoSnapshotRef.current = baselineSnapshotRef.current
      ? { ...baselineSnapshotRef.current }
      : null;
    const committedStyleId = baselineSnapshotRef.current?.trainingStyleId ?? "balanced_default";
    const styleChanged = nextStyleId !== committedStyleId;
    pendingStyleAuditRef.current = styleChanged
      ? {
          changedAtIso: new Date().toISOString(),
          fromStyleId: committedStyleId,
          toStyleId: nextStyleId,
          recalculations: buildRecalculationSummary(nextStyleId),
        }
      : null;
    return { committedStyleId, styleChanged };
  }, []);

  const userName = getUserDisplayName(user);
  const hasRequiredMafInputs = useCallback(() => {
    const age = preferences?.mafAge;
    return Number.isInteger(age) && age! >= 16 && age! <= 99 && Boolean(preferences?.mafConsistency) && Boolean(preferences?.mafTrend);
  }, [preferences?.mafAge, preferences?.mafConsistency, preferences?.mafTrend]);

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
      <div className="p-4 md:p-8 max-w-2xl mx-auto">
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
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-6">
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
      <Card>
        <CardHeader><CardTitle>Training style</CardTitle><CardDescription>Changing style updates future analysis and plan generation behavior.</CardDescription></CardHeader>
        <CardContent>
          <Select value={trainingStyleId} onValueChange={(v) => { setStyleSwitchBlockedMessage(null); setPendingStyleId(v); setConfirmStyleOpen(true); }}>
            <SelectTrigger className="max-w-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="balanced_default">Balanced</SelectItem><SelectItem value="maf_method">MAF Method</SelectItem></SelectContent>
          </Select>
        </CardContent>
      </Card>
      {styleTransitionNotice && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle className="text-base">Style transition notice</CardTitle>
            <CardDescription>{styleTransitionNotice}</CardDescription>
          </CardHeader>
        </Card>
      )}
      {styleSwitchBlockedMessage && (
        <p className="text-sm text-destructive" data-testid="maf-switch-blocked">{styleSwitchBlockedMessage}</p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Why this recommendation</CardTitle>
          <CardDescription>
            Active style: <strong>{getStyleLabel(trainingStyleId)}</strong>. Current phase: style transition.
            Key constraints: {trainingStyleId === "maf_method" ? "MAF uses HR ceiling framing (stay at or under your ceiling; it is not a target to chase)." : "Balanced style blends aerobic work, quality sessions, and recovery constraints."}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <div className="flex gap-2"><Info className="h-4 w-4 mt-0.5" /><p>Recommendations are explained using your current style first, then filtered by saved constraints and available baseline data.</p></div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Settings audit</CardTitle><CardDescription>Tracks training-style changes and triggered downstream recalculations.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {styleAuditEntries.length === 0 ? <p className="text-sm text-muted-foreground">No training-style changes recorded yet.</p> : styleAuditEntries.map((entry) => (
            <div key={entry.changedAtIso} className="rounded-md border p-3 text-sm">
              <p className="font-medium">{new Date(entry.changedAtIso).toLocaleString()} — {getStyleLabel(entry.fromStyleId)} → {getStyleLabel(entry.toStyleId)}</p>
              <ul className="list-disc pl-5 text-muted-foreground">{entry.recalculations.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          ))}
        </CardContent>
      </Card>

      <AlertDialog open={confirmStyleOpen} onOpenChange={setConfirmStyleOpen}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Change training style?</AlertDialogTitle><AlertDialogDescription>This will change how your AI analysis works and affect future plans. We’ll re-baseline MAF settings when needed.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction
              onClick={() => {
                if (!pendingStyleId) {
                  return;
                }
                if (pendingStyleId === "maf_method" && !hasRequiredMafInputs()) {
                  setStyleSwitchBlockedMessage("Complete MAF setup to switch styles");
                  setMafSetupOpen(true);
                  return;
                }
                setTrainingStyleId(pendingStyleId);
                setStyleTransitionNotice(
                  `Switched to ${getStyleLabel(pendingStyleId)}. Immediate: coaching language and new recommendations update now. After re-baseline: future trend analysis and longer-horizon plan adjustments will settle once new baseline data is captured.`,
                );
              }}
            >
              Confirm
            </AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={mafSetupOpen} onOpenChange={setMafSetupOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Complete MAF setup</AlertDialogTitle><AlertDialogDescription>Required fields are marked. Optional field: HR data available.</AlertDialogDescription></AlertDialogHeader>
          <div className="space-y-3">
            <Input placeholder="Age (required)" value={mafAgeInput} onChange={(e) => setMafAgeInput(e.target.value)} data-testid="maf-age-input" />
            <Select value={mafConsistencyInput} onValueChange={(v: "low" | "moderate" | "high") => setMafConsistencyInput(v)}><SelectTrigger><SelectValue placeholder="Consistency (required)" /></SelectTrigger><SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="moderate">Moderate</SelectItem><SelectItem value="high">High</SelectItem></SelectContent></Select>
            <Select value={mafTrendInput} onValueChange={(v: "improving" | "flat" | "declining") => setMafTrendInput(v)}><SelectTrigger><SelectValue placeholder="Trend (required)" /></SelectTrigger><SelectContent><SelectItem value="improving">Improving</SelectItem><SelectItem value="flat">Flat</SelectItem><SelectItem value="declining">Declining</SelectItem></SelectContent></Select>
            <Select value={mafHrDataAvailableInput} onValueChange={(v: "yes" | "no") => setMafHrDataAvailableInput(v)}><SelectTrigger><SelectValue placeholder="HR data available (optional)" /></SelectTrigger><SelectContent><SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem></SelectContent></Select>
            {mafSetupError && <p className="text-sm text-destructive">{mafSetupError}</p>}
          </div>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={(e) => {
            const parsedAge = Number.parseInt(mafAgeInput, 10);
            if (!Number.isInteger(parsedAge) || parsedAge < 16 || parsedAge > 99 || !mafConsistencyInput || !mafTrendInput) {
              e.preventDefault();
              setMafSetupError("Enter a valid age and select required MAF fields.");
              return;
            }
            setMafSetupError(null);
            if (!pendingStyleId) return;
            const { committedStyleId, styleChanged } = stageSaveAuditState(pendingStyleId);
            const maf = calculateMafHr({ age: parsedAge, injuryIllnessMedication: Boolean(preferences?.mafInjuryIllnessMedication), consistency: mafConsistencyInput, trend: mafTrendInput });
            saveMutation.mutate({
              weightUnit, distanceUnit, weeklyGoal: Number.parseInt(weeklyGoal, 10), emailNotifications, emailWeeklySummary, emailMissedReminder, showAdherenceInsights, aiCoachEnabled,
              trainingStyleId: pendingStyleId, mafAge: parsedAge, mafConsistency: mafConsistencyInput, mafTrend: mafTrendInput,
              mafHrDataAvailable: mafHrDataAvailableInput ? mafHrDataAvailableInput === "yes" : undefined,
              trainingStylePreviousId: styleChanged ? committedStyleId : undefined, trainingStyleChangedAt: styleChanged ? new Date().toISOString() : undefined, trainingStyleRecomputeNow: styleChanged,
              mafHr: styleChanged ? maf.ceiling : undefined, mafBaselineTestScheduledAt: styleChanged ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() : undefined,
            });
            setTrainingStyleId(pendingStyleId);
            setMafSetupOpen(false);
            setStyleSwitchBlockedMessage(null);
          }}>Save MAF setup</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
              clearLocalOnboardingComplete();
              setLocation("/?onboarding=run");
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
    </div>
  );
}
