import { useQuery } from "@tanstack/react-query";
import { Bell, Database, Dumbbell, Link2, Loader2, RotateCw, User } from "lucide-react";
import { useEffect } from "react";
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
import { TrainingStyleSection } from "@/components/settings/TrainingStyleSection";
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
import { clearLocalOnboardingComplete } from "@/hooks/onboardingStorage";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useUnsavedChangesPrompt } from "@/hooks/useUnsavedChangesPrompt";
import { useUrlQueryState } from "@/hooks/useUrlQueryState";
import { type GarminStatus, QUERY_KEYS, type StravaStatus } from "@/lib/api";
import { getUserDisplayName } from "@/lib/authUtils";

import { usePreferencesForm } from "./settings/usePreferencesForm";

// Tab ids double as the `?tab=` deep-link value. `account` is the default
// landing tab (omitted from the URL by useUrlQueryState).
const SETTINGS_TABS = ["account", "training", "integrations", "notifications", "data"] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

export default function Settings() {
  useDocumentTitle("Settings");
  const { toast } = useToast();
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const [activeTab, setActiveTab] = useUrlQueryState<SettingsTab>("tab", "account", SETTINGS_TABS);
  const {
    draft,
    updateField,
    hasChanges,
    styleAuditEntries,
    hasRequiredMafInputs,
    handleSave,
    isSaving,
    preferences,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = usePreferencesForm();
  const settingsSearchPath = search ? `?${search}` : "";
  const currentSettingsPath = `${location}${settingsSearchPath}`;
  const unsavedChangesPrompt = useUnsavedChangesPrompt({
    enabled: hasChanges,
    currentPath: currentSettingsPath,
    navigate: setLocation,
  });

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

  const { data: stravaStatus, isLoading: stravaLoading } =
    useQuery<StravaStatus>({
      queryKey: QUERY_KEYS.stravaStatus,
    });

  const { data: garminStatus, isLoading: garminLoading } =
    useQuery<GarminStatus>({
      queryKey: QUERY_KEYS.garminStatus,
    });

  const userName = getUserDisplayName(user);

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
            weightUnit={draft.weightUnit}
            distanceUnit={draft.distanceUnit}
            onWeightUnitChange={(v) => {
              updateField("weightUnit", v);
            }}
            onDistanceUnitChange={(v) => {
              updateField("distanceUnit", v);
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
            division={draft.division}
            gender={draft.gender}
            age={draft.ageInput}
            onDivisionChange={(v) => updateField("division", v)}
            onGenderChange={(v) => updateField("gender", v)}
            onAgeChange={(v) => updateField("ageInput", v)}
          />
          <BodyCompositionCard
            weightUnit={draft.weightUnit}
            bodyweightKg={draft.bodyweightKg}
            heightCm={draft.heightCm}
            activityLevel={draft.activityLevel}
            weightGoalDirection={draft.weightGoalDirection}
            weightGoalRateKgPerWeek={draft.weightGoalRateKgPerWeek}
            onBodyweightKgChange={(v) => updateField("bodyweightKg", v)}
            onHeightCmChange={(v) => updateField("heightCm", v)}
            onActivityLevelChange={(v) => updateField("activityLevel", v)}
            onWeightGoalDirectionChange={(v) => updateField("weightGoalDirection", v)}
            onWeightGoalRateKgPerWeekChange={(v) => updateField("weightGoalRateKgPerWeek", v)}
          />
          <HealthMetricsCard
            restingHr={draft.restingHrInput}
            maxHr={draft.maxHrInput}
            ftp={draft.ftpInput}
            onRestingHrChange={(v) => updateField("restingHrInput", v)}
            onMaxHrChange={(v) => updateField("maxHrInput", v)}
            onFtpChange={(v) => updateField("ftpInput", v)}
          />
          <NutritionPreferencesCard
            mealSchedule={draft.mealSchedule}
            onMealScheduleChange={(v) => updateField("mealSchedule", v)}
          />
          <TrainingGoalsCard
            weeklyGoal={draft.weeklyGoal}
            onWeeklyGoalChange={(v) => {
              updateField("weeklyGoal", v);
            }}
          />
          <TrainingStyleSection
            trainingStyleId={draft.trainingStyleId}
            onTrainingStyleIdChange={(v) => updateField("trainingStyleId", v)}
            hasRequiredMafInputs={hasRequiredMafInputs}
            mafAgeInput={draft.mafAgeInput}
            mafConsistencyInput={draft.mafConsistencyInput}
            mafTrendInput={draft.mafTrendInput}
            mafHrDataAvailableInput={draft.mafHrDataAvailableInput}
            onMafAgeInputChange={(v) => updateField("mafAgeInput", v)}
            onMafConsistencyInputChange={(v) => updateField("mafConsistencyInput", v)}
            onMafTrendInputChange={(v) => updateField("mafTrendInput", v)}
            onMafHrDataAvailableInputChange={(v) => updateField("mafHrDataAvailableInput", v)}
            styleAuditEntries={styleAuditEntries}
          />
          <WorkoutReviewCard
            showAdherenceInsights={draft.showAdherenceInsights}
            onShowAdherenceInsightsChange={(v) => {
              updateField("showAdherenceInsights", v);
            }}
          />
          <AiCoachCard
            aiCoachEnabled={draft.aiCoachEnabled}
            onAiCoachEnabledChange={(v) => {
              updateField("aiCoachEnabled", v);
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
            emailNotifications={draft.emailNotifications}
            emailWeeklySummary={draft.emailWeeklySummary}
            emailMissedReminder={draft.emailMissedReminder}
            onEmailNotificationsChange={(v) => {
              updateField("emailNotifications", v);
            }}
            onEmailWeeklySummaryChange={(v) => {
              updateField("emailWeeklySummary", v);
            }}
            onEmailMissedReminderChange={(v) => {
              updateField("emailMissedReminder", v);
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
            disabled={isSaving}
          >
            {isSaving ? (
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
