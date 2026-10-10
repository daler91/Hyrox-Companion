import { useQuery } from "@tanstack/react-query";
import { Bell, Database, Dumbbell, Link2, RotateCw, Trash2, User } from "lucide-react";
import { Suspense, useCallback } from "react";

import { AccountDangerZone } from "@/components/settings/AccountDangerZone";
import { lazyWithReload } from "@/lib/lazyWithReload";

// ⚡ Bolt Performance Optimization:
// Code-split Settings tabs using React.lazy to defer loading heavy components
// until their respective tabs are activated. This reduces the initial JS bundle
// footprint, speeding up the time-to-interactive for the primary 'Account' tab.
// Impact: Reduced initial load by separating ~14 lazy-loaded chunks for hidden tabs.
// Only the hidden tabs: the Account tab has no Suspense of its own, so a lazy
// section there would suspend the whole page to the route-level spinner.
const CoachingSection = lazyWithReload(() => import("@/components/settings/CoachingSection").then((m) => ({ default: m.CoachingSection })));
const RecycleBinCard = lazyWithReload(() => import("@/components/settings/data-tools/RecycleBinCard").then((m) => ({ default: m.RecycleBinCard })));
const DataToolsSection = lazyWithReload(() => import("@/components/settings/DataToolsSection").then((m) => ({ default: m.DataToolsSection })));
const GarminSection = lazyWithReload(() => import("@/components/settings/GarminSection").then((m) => ({ default: m.GarminSection })));
const AiCoachCard = lazyWithReload(() => import("@/components/settings/preferences/AiCoachCard").then((m) => ({ default: m.AiCoachCard })));
const AthleteProfileCard = lazyWithReload(() => import("@/components/settings/preferences/AthleteProfileCard").then((m) => ({ default: m.AthleteProfileCard })));
const BodyCompositionCard = lazyWithReload(() => import("@/components/settings/preferences/BodyCompositionCard").then((m) => ({ default: m.BodyCompositionCard })));
const EmailNotificationsCard = lazyWithReload(() => import("@/components/settings/preferences/EmailNotificationsCard").then((m) => ({ default: m.EmailNotificationsCard })));
const HealthMetricsCard = lazyWithReload(() => import("@/components/settings/preferences/HealthMetricsCard").then((m) => ({ default: m.HealthMetricsCard })));
const NutritionPreferencesCard = lazyWithReload(() => import("@/components/settings/preferences/NutritionPreferencesCard").then((m) => ({ default: m.NutritionPreferencesCard })));
const TrainingGoalsCard = lazyWithReload(() => import("@/components/settings/preferences/TrainingGoalsCard").then((m) => ({ default: m.TrainingGoalsCard })));
const WorkoutReviewCard = lazyWithReload(() => import("@/components/settings/preferences/WorkoutReviewCard").then((m) => ({ default: m.WorkoutReviewCard })));
const PushNotificationSection = lazyWithReload(() => import("@/components/settings/PushNotificationSection").then((m) => ({ default: m.PushNotificationSection })));
const StravaSection = lazyWithReload(() => import("@/components/settings/StravaSection").then((m) => ({ default: m.StravaSection })));
const TrainingStyleSection = lazyWithReload(() => import("@/components/settings/TrainingStyleSection").then((m) => ({ default: m.TrainingStyleSection })));

import { AthleteCardSection } from "@/components/settings/athlete-card/AthleteCardSection";
import { UnitsPreferencesCard } from "@/components/settings/preferences/UnitsPreferencesCard";
import { ProfileSection } from "@/components/settings/ProfileSection";
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
import { useAuth } from "@/hooks/useAuth";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useUrlQueryState } from "@/hooks/useUrlQueryState";
import { type GarminStatus, QUERY_KEYS, type StravaStatus } from "@/lib/api";
import { getUserDisplayName } from "@/lib/authUtils";

import { SaveSettingsBar } from "./settings/SaveSettingsBar";
import { SettingsLoadError } from "./settings/SettingsLoadError";
import { usePreferencesForm } from "./settings/usePreferencesForm";
import { useSettingsUnsavedChangesGuard } from "./settings/useSettingsUnsavedChangesGuard";
import { useStravaCallbackToast } from "./settings/useStravaCallbackToast";

// Tab ids double as the `?tab=` deep-link value. `account` is the default
// landing tab (omitted from the URL by useUrlQueryState).
const SETTINGS_TABS = [
  "account",
  "training",
  "integrations",
  "notifications",
  "data",
  "recycle-bin",
] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

export default function Settings() {
  useDocumentTitle("Settings");
  const { user } = useAuth();
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
  const unsavedChangesPrompt = useSettingsUnsavedChangesGuard(hasChanges);
  const landOnIntegrations = useCallback(() => setActiveTab("integrations"), [setActiveTab]);
  useStravaCallbackToast(landOnIntegrations);

  const { data: stravaStatus, isLoading: stravaLoading } = useQuery<StravaStatus>({
    queryKey: QUERY_KEYS.stravaStatus,
  });

  const { data: garminStatus, isLoading: garminLoading } = useQuery<GarminStatus>({
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
    return <SettingsLoadError error={error} isFetching={isFetching} onRetry={() => refetch()} />;
  }

  return (
    <PageContainer size="narrow" className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your account and preferences</p>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(value as SettingsTab);
        }}
        className="w-full"
      >
        <TabsList className="mb-6 grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-3">
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
          <TabsTrigger value="data" data-testid="tab-data">
            <Database className="h-4 w-4 mr-2" aria-hidden="true" />
            Data &amp; Privacy
          </TabsTrigger>
          <TabsTrigger value="recycle-bin" data-testid="tab-recycle-bin">
            <Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />
            Recycle bin
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
                Run the welcome flow again if you skipped it or want to pick a different training
                plan.
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
          <Suspense fallback={<div className="p-8 text-center"><LoadingSpinner /></div>}>
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

          <AthleteCardSection legacyNote={user?.trainingConstraints} />
          <TrainingStyleSection
            trainingStyleId={draft.trainingStyleId}
            onTrainingStyleIdChange={(v) => updateField("trainingStyleId", v)}
            hasRequiredMafInputs={hasRequiredMafInputs}
            mafHr={user?.mafHr}
            mafAgeInput={draft.mafAgeInput}
            mafCategoryInput={draft.mafCategoryInput}
            mafHrDataAvailableInput={draft.mafHrDataAvailableInput}
            onMafAgeInputChange={(v) => updateField("mafAgeInput", v)}
            onMafCategoryInputChange={(v) => updateField("mafCategoryInput", v)}
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
            coachAutoApplyPlanChanges={draft.coachAutoApplyPlanChanges}
            onCoachAutoApplyPlanChangesChange={(v) => {
              updateField("coachAutoApplyPlanChanges", v);
            }}
          />
          <CoachingSection />
          </Suspense>
        </TabsContent>

        <TabsContent value="integrations" className="space-y-6">
          <Suspense fallback={<div className="p-8 text-center"><LoadingSpinner /></div>}>
          <StravaSection stravaStatus={stravaStatus} stravaLoading={stravaLoading} />
          <GarminSection garminStatus={garminStatus} garminLoading={garminLoading} />
          </Suspense>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-6">
          <Suspense fallback={<div className="p-8 text-center"><LoadingSpinner /></div>}>
          <EmailNotificationsCard
            emailNotifications={draft.emailNotifications}
            emailWeeklySummary={draft.emailWeeklySummary}
            emailMissedReminder={draft.emailMissedReminder}
            emailWeeklyReviewReminder={draft.emailWeeklyReviewReminder}
            emailTodaySession={draft.emailTodaySession}
            emailAnalysisDigest={draft.emailAnalysisDigest}
            notifyHour={draft.notifyHour}
            notifyHourWeeklySummary={draft.notifyHourWeeklySummary}
            notifyHourMissedReminder={draft.notifyHourMissedReminder}
            notifyHourWeeklyReviewReminder={draft.notifyHourWeeklyReviewReminder}
            notifyHourTodaySession={draft.notifyHourTodaySession}
            notifyHourAnalysisDigest={draft.notifyHourAnalysisDigest}
            onEmailNotificationsChange={(v) => {
              updateField("emailNotifications", v);
            }}
            onEmailWeeklySummaryChange={(v) => {
              updateField("emailWeeklySummary", v);
            }}
            onEmailMissedReminderChange={(v) => {
              updateField("emailMissedReminder", v);
            }}
            onEmailWeeklyReviewReminderChange={(v) => {
              updateField("emailWeeklyReviewReminder", v);
            }}
            onEmailTodaySessionChange={(v) => {
              updateField("emailTodaySession", v);
            }}
            onEmailAnalysisDigestChange={(v) => {
              updateField("emailAnalysisDigest", v);
            }}
            onNotifyHourChange={(v) => {
              updateField("notifyHour", v);
            }}
            onNotifyHourWeeklySummaryChange={(v) => {
              updateField("notifyHourWeeklySummary", v);
            }}
            onNotifyHourMissedReminderChange={(v) => {
              updateField("notifyHourMissedReminder", v);
            }}
            onNotifyHourWeeklyReviewReminderChange={(v) => {
              updateField("notifyHourWeeklyReviewReminder", v);
            }}
            onNotifyHourTodaySessionChange={(v) => {
              updateField("notifyHourTodaySession", v);
            }}
            onNotifyHourAnalysisDigestChange={(v) => {
              updateField("notifyHourAnalysisDigest", v);
            }}
          />
          <PushNotificationSection />
          </Suspense>
        </TabsContent>

        <TabsContent value="data" className="space-y-6">
          <Suspense fallback={<div className="p-8 text-center"><LoadingSpinner /></div>}>
          <DataToolsSection />
          </Suspense>
        </TabsContent>

        <TabsContent value="recycle-bin" className="space-y-6">
          <Suspense fallback={<div className="p-8 text-center"><LoadingSpinner /></div>}>
          <RecycleBinCard />
          </Suspense>
        </TabsContent>
      </Tabs>

      <SaveSettingsBar hasChanges={hasChanges} isSaving={isSaving} onSave={handleSave} />

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
