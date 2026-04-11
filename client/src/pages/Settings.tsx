import { useMutation,useQuery } from "@tanstack/react-query";
import { Loader2, RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";

import { CoachingSection } from "@/components/settings/CoachingSection";
import { DataToolsSection } from "@/components/settings/DataToolsSection";
import { PreferencesSection } from "@/components/settings/PreferencesSection";
import { ProfileSection } from "@/components/settings/ProfileSection";
import { PushNotificationSection } from "@/components/settings/PushNotificationSection";
import { StravaSection } from "@/components/settings/StravaSection";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { api, QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

interface Preferences {
  weightUnit: string;
  distanceUnit: string;
  weeklyGoal: number;
  emailNotifications: boolean;
  aiCoachEnabled: boolean;
}

interface StravaStatus {
  connected: boolean;
  athleteId?: string;
  lastSyncedAt?: string | null;
}

interface PreferencesSnapshot {
  weightUnit: string;
  distanceUnit: string;
  weeklyGoal: string;
  emailNotifications: boolean;
  aiCoachEnabled: boolean;
}

function preferencesToSnapshot(
  preferences: Pick<Preferences, "weightUnit" | "distanceUnit" | "weeklyGoal" | "emailNotifications" | "aiCoachEnabled">,
): PreferencesSnapshot {
  return {
    weightUnit: preferences.weightUnit || "kg",
    distanceUnit: preferences.distanceUnit || "km",
    weeklyGoal: String(preferences.weeklyGoal || 5),
    emailNotifications: preferences.emailNotifications,
    aiCoachEnabled: preferences.aiCoachEnabled ?? true,
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
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [aiCoachEnabled, setAiCoachEnabled] = useState(true);
  const [hasChanges, setHasChanges] = useState(false);
  // Snapshot of values before the most recent save, used to offer an
  // "Undo" action on the post-save toast.
  const undoSnapshotRef = useRef<PreferencesSnapshot | null>(null);
  // Tracks the last values we know the server has committed. Initialized
  // from the preferences query once it loads, and kept in sync by
  // saveMutation.onSuccess. Reading from here for the undo snapshot avoids
  // the stale-query race where `preferences` lags behind back-to-back saves
  // while invalidation is still refetching.
  const lastCommittedRef = useRef<PreferencesSnapshot | null>(null);

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

  const { data: preferences, isLoading } = useQuery<Preferences>({
    queryKey: QUERY_KEYS.preferences,
  });

  const { data: stravaStatus, isLoading: stravaLoading } =
    useQuery<StravaStatus>({
      queryKey: QUERY_KEYS.stravaStatus,
    });

  useEffect(() => {
    if (preferences) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWeightUnit(preferences.weightUnit || "kg");
      setDistanceUnit(preferences.distanceUnit || "km");
      setWeeklyGoal(String(preferences.weeklyGoal || 5));
      setEmailNotifications(preferences.emailNotifications);
      setAiCoachEnabled(preferences.aiCoachEnabled ?? true);
      // Seed the committed-state tracker the first time preferences load.
      // Subsequent updates come from saveMutation.onSuccess so we don't
      // clobber an in-flight undo target with a query refetch.
      if (!lastCommittedRef.current) {
        lastCommittedRef.current = preferencesToSnapshot(preferences);
      }
    }
  }, [preferences]);

  const saveMutation = useMutation({
    mutationFn: (data: {
      weightUnit: string;
      distanceUnit: string;
      weeklyGoal: number;
      emailNotifications: boolean;
      aiCoachEnabled: boolean;
    }) => api.preferences.update(data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.preferences }).catch(() => {});
      // Promote the values we just persisted to the committed-state
      // tracker so the NEXT save's undo snapshot sees these — not
      // whatever the (still-invalidating) preferences query happens to
      // return in the meantime.
      lastCommittedRef.current = {
        weightUnit: variables.weightUnit,
        distanceUnit: variables.distanceUnit,
        weeklyGoal: String(variables.weeklyGoal),
        emailNotifications: variables.emailNotifications,
        aiCoachEnabled: variables.aiCoachEnabled,
      };
      setHasChanges(false);
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
              setAiCoachEnabled(previous.aiCoachEnabled);
              saveMutation.mutate({
                weightUnit: previous.weightUnit,
                distanceUnit: previous.distanceUnit,
                weeklyGoal: Number.parseInt(previous.weeklyGoal, 10),
                emailNotifications: previous.emailNotifications,
                aiCoachEnabled: previous.aiCoachEnabled,
              });
            }}
          >
            Undo
          </ToastAction>
        ) : undefined,
      });
    },
    onError: () => {
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
    // Capture the pre-save values from the committed-state tracker so the
    // post-save toast can offer Undo. Using lastCommittedRef instead of
    // the `preferences` query means back-to-back saves don't race against
    // a still-pending refetch.
    undoSnapshotRef.current = lastCommittedRef.current
      ? { ...lastCommittedRef.current }
      : null;
    saveMutation.mutate({
      weightUnit,
      distanceUnit,
      weeklyGoal: Number.parseInt(weeklyGoal, 10),
      emailNotifications,
      aiCoachEnabled,
    });
  }, [saveMutation, weightUnit, distanceUnit, weeklyGoal, emailNotifications, aiCoachEnabled]);

  const markChanged = () => setHasChanges(true);

  let userName = "User";
  if (user) {
    if (user.firstName && user.lastName) {
      userName = `${user.firstName} ${user.lastName}`;
    } else if (user.email) {
      userName = user.email;
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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

      <PreferencesSection
        weightUnit={weightUnit}
        distanceUnit={distanceUnit}
        weeklyGoal={weeklyGoal}
        emailNotifications={emailNotifications}
        aiCoachEnabled={aiCoachEnabled}
        onWeightUnitChange={(v) => {
          setWeightUnit(v);
          markChanged();
        }}
        onDistanceUnitChange={(v) => {
          setDistanceUnit(v);
          markChanged();
        }}
        onWeeklyGoalChange={(v) => {
          setWeeklyGoal(v);
          markChanged();
        }}
        onEmailNotificationsChange={(v) => {
          setEmailNotifications(v);
          markChanged();
        }}
        onAiCoachEnabledChange={(v) => {
          setAiCoachEnabled(v);
          markChanged();
        }}
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
              localStorage.removeItem("hyrox-onboarding-complete");
              setLocation("/?onboarding=run");
            }}
          >
            <RotateCw className="h-4 w-4 mr-2" aria-hidden="true" />
            Run setup again
          </Button>
        </CardContent>
      </Card>

      <DataToolsSection />

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
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
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
