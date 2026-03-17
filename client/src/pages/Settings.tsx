import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";
import { useLocation, useSearch } from "wouter";
import { ProfileSection } from "@/components/settings/ProfileSection";
import { StravaSection } from "@/components/settings/StravaSection";
import { PreferencesSection } from "@/components/settings/PreferencesSection";
import { DataToolsSection } from "@/components/settings/DataToolsSection";

interface Preferences {
  weightUnit: string;
  distanceUnit: string;
  weeklyGoal: number;
  emailNotifications: number;
}

interface StravaStatus {
  connected: boolean;
  athleteId?: string;
  lastSyncedAt?: string | null;
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
  const [hasChanges, setHasChanges] = useState(false);

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
    queryKey: ["/api/v1/preferences"],
  });

  const { data: stravaStatus, isLoading: stravaLoading } =
    useQuery<StravaStatus>({
      queryKey: ["/api/v1/strava/status"],
    });

  useEffect(() => {
    if (preferences) {
      setWeightUnit(preferences.weightUnit || "kg");
      setDistanceUnit(preferences.distanceUnit || "km");
      setWeeklyGoal(String(preferences.weeklyGoal || 5));
      setEmailNotifications(preferences.emailNotifications === 1);
    }
  }, [preferences]);

  const saveMutation = useMutation({
    mutationFn: async (data: {
      weightUnit: string;
      distanceUnit: string;
      weeklyGoal: number;
      emailNotifications: number;
    }) => {
      const response = await apiRequest("PATCH", "/api/v1/preferences", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/preferences"] });
      setHasChanges(false);
      toast({
        title: "Settings saved",
        description: "Your preferences have been updated.",
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

  const handleSave = () => {
    saveMutation.mutate({
      weightUnit,
      distanceUnit,
      weeklyGoal: Number.parseInt(weeklyGoal, 10),
      emailNotifications: emailNotifications ? 1 : 0,
    });
  };

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
      />

      <DataToolsSection />

      <Button
        onClick={handleSave}
        className="w-full"
        data-testid="button-save-settings"
        disabled={!hasChanges || saveMutation.isPending}
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
  );
}
