import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Link2, RefreshCw, Unlink, Download, FileSpreadsheet, FileJson, Sparkles, Mail } from "lucide-react";
import { SiStrava } from "react-icons/si";
import { Switch } from "@/components/ui/switch";
import { useLocation, useSearch } from "wouter";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";

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
  const [unstructuredCount, setUnstructuredCount] = useState<number | null>(null);
  const [parseResults, setParseResults] = useState<{ success: number; failed: number } | null>(null);

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
    queryKey: ["/api/preferences"],
  });

  const { data: stravaStatus, isLoading: stravaLoading } = useQuery<StravaStatus>({
    queryKey: ["/api/strava/status"],
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
    mutationFn: async (data: { weightUnit: string; distanceUnit: string; weeklyGoal: number; emailNotifications: number }) => {
      const response = await apiRequest("PATCH", "/api/preferences", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/preferences"] });
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

  const connectStravaMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("GET", "/api/strava/auth");
      return response.json();
    },
    onSuccess: (data: { authUrl: string }) => {
      window.location.href = data.authUrl;
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to initiate Strava connection.",
        variant: "destructive",
      });
    },
  });

  const disconnectStravaMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/strava/disconnect");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strava/status"] });
      toast({
        title: "Strava Disconnected",
        description: "Your Strava account has been disconnected.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to disconnect Strava.",
        variant: "destructive",
      });
    },
  });

  const syncStravaMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/strava/sync");
      return response.json();
    },
    onSuccess: (data: { imported: number; skipped: number; total: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/strava/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workouts"] });
      toast({
        title: "Sync Complete",
        description: `Imported ${data.imported} new activities. ${data.skipped} already existed.`,
      });
    },
    onError: () => {
      toast({
        title: "Sync Failed",
        description: "Failed to sync activities from Strava.",
        variant: "destructive",
      });
    },
  });

  const findUnstructuredMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("GET", "/api/workouts/unstructured");
      return response.json();
    },
    onSuccess: (data: any[]) => {
      setUnstructuredCount(data.length);
      toast({
        title: "Search Complete",
        description: `Found ${data.length} workouts without structured exercise data.`,
      });
    },
    onError: () => {
      toast({
        title: "Search Failed",
        description: "Failed to find unstructured workouts.",
        variant: "destructive",
      });
    },
  });

  const batchReparseMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/workouts/batch-reparse");
      return response.json();
    },
    onSuccess: (data: { total: number; parsed: number; failed: number }) => {
      setParseResults({ success: data.parsed, failed: data.failed });
      queryClient.invalidateQueries({ queryKey: ["/api/timeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workouts"] });
      toast({
        title: "Parsing Complete",
        description: `Parsed ${data.parsed} workouts successfully. ${data.failed} could not be parsed.`,
      });
    },
    onError: () => {
      toast({
        title: "Parsing Failed",
        description: "Failed to parse workouts with AI.",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    saveMutation.mutate({
      weightUnit,
      distanceUnit,
      weeklyGoal: parseInt(weeklyGoal, 10),
      emailNotifications: emailNotifications ? 1 : 0,
    });
  };

  const handleWeightUnitChange = (value: string) => {
    setWeightUnit(value);
    setHasChanges(true);
  };

  const handleDistanceUnitChange = (value: string) => {
    setDistanceUnit(value);
    setHasChanges(true);
  };

  const handleWeeklyGoalChange = (value: string) => {
    setWeeklyGoal(value);
    setHasChanges(true);
  };

  const userName = user
    ? user.firstName && user.lastName
      ? `${user.firstName} ${user.lastName}`
      : user.email || "User"
    : "User";

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

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your personal information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Display Name</Label>
            <p className="text-sm text-muted-foreground" data-testid="text-display-name">
              {userName}
            </p>
            <p className="text-xs text-muted-foreground">
              Your name is managed through your login provider
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Integrations
          </CardTitle>
          <CardDescription>Connect external services to sync your workouts</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-md bg-[#FC4C02]/10">
                <SiStrava className="h-5 w-5 text-[#FC4C02]" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Label>Strava</Label>
                  {stravaStatus?.connected && (
                    <Badge variant="outline" className="text-xs">Connected</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {stravaStatus?.connected 
                    ? stravaStatus.lastSyncedAt 
                      ? `Last synced ${formatDistanceToNow(new Date(stravaStatus.lastSyncedAt), { addSuffix: true })}`
                      : "Not yet synced"
                    : "Import activities from Strava"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {stravaStatus?.connected ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => syncStravaMutation.mutate()}
                    disabled={syncStravaMutation.isPending}
                    data-testid="button-sync-strava"
                  >
                    {syncStravaMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    <span className="ml-1.5">Sync</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => disconnectStravaMutation.mutate()}
                    disabled={disconnectStravaMutation.isPending}
                    data-testid="button-disconnect-strava"
                  >
                    {disconnectStravaMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Unlink className="h-4 w-4" />
                    )}
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => connectStravaMutation.mutate()}
                  disabled={connectStravaMutation.isPending || stravaLoading}
                  data-testid="button-connect-strava"
                >
                  {connectStravaMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  ) : (
                    <SiStrava className="h-4 w-4 mr-1.5 text-[#FC4C02]" />
                  )}
                  Connect
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Units</CardTitle>
          <CardDescription>Choose your preferred measurement units</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label>Weight Unit</Label>
              <p className="text-sm text-muted-foreground">For sled weights, wall balls, etc.</p>
            </div>
            <Select value={weightUnit} onValueChange={handleWeightUnitChange}>
              <SelectTrigger className="w-24" data-testid="select-weight-unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="kg">kg</SelectItem>
                <SelectItem value="lbs">lbs</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label>Distance Unit</Label>
              <p className="text-sm text-muted-foreground">For running, rowing, etc.</p>
            </div>
            <Select value={distanceUnit} onValueChange={handleDistanceUnitChange}>
              <SelectTrigger className="w-24" data-testid="select-distance-unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="km">km</SelectItem>
                <SelectItem value="miles">miles</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Training Goals</CardTitle>
          <CardDescription>Set your weekly training targets</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label>Weekly Workout Goal</Label>
              <p className="text-sm text-muted-foreground">Target number of workouts per week</p>
            </div>
            <Select value={weeklyGoal} onValueChange={handleWeeklyGoalChange}>
              <SelectTrigger className="w-24" data-testid="select-weekly-goal">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3">3</SelectItem>
                <SelectItem value="4">4</SelectItem>
                <SelectItem value="5">5</SelectItem>
                <SelectItem value="6">6</SelectItem>
                <SelectItem value="7">7</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Email Notifications
              </Label>
              <p className="text-sm text-muted-foreground">Receive weekly training summaries and missed workout reminders</p>
            </div>
            <Switch
              checked={emailNotifications}
              onCheckedChange={(checked) => {
                setEmailNotifications(checked);
                setHasChanges(true);
              }}
              data-testid="switch-email-notifications"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Structure Old Workouts
          </CardTitle>
          <CardDescription>Use AI to convert free-text workout descriptions into structured exercise data</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {unstructuredCount === null && parseResults === null ? (
            <div>
              <p className="text-sm text-muted-foreground mb-4">
                Find and parse unstructured workout descriptions to extract exercise data using AI.
              </p>
              <Button
                onClick={() => findUnstructuredMutation.mutate()}
                disabled={findUnstructuredMutation.isPending}
                data-testid="button-find-unstructured"
                variant="outline"
              >
                {findUnstructuredMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Searching...
                  </>
                ) : (
                  "Find Unstructured Workouts"
                )}
              </Button>
            </div>
          ) : null}

          {unstructuredCount !== null && parseResults === null ? (
            <div>
              <p className="text-sm text-muted-foreground mb-4" data-testid="text-unstructured-count">
                Found {unstructuredCount} workouts without structured exercise data
              </p>
              {unstructuredCount > 0 ? (
                <Button
                  onClick={() => batchReparseMutation.mutate()}
                  disabled={batchReparseMutation.isPending}
                  data-testid="button-batch-reparse"
                >
                  {batchReparseMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Parsing...
                    </>
                  ) : (
                    "Parse All with AI"
                  )}
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  All your workouts are already structured.
                </p>
              )}
            </div>
          ) : null}

          {parseResults !== null ? (
            <div>
              <p className="text-sm text-muted-foreground mb-4" data-testid="text-parse-results">
                Parsed {parseResults.success} workouts successfully. {parseResults.failed} could not be parsed.
              </p>
              <Button
                onClick={() => {
                  setUnstructuredCount(null);
                  setParseResults(null);
                }}
                variant="outline"
                size="sm"
              >
                Run Again
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Export Data
          </CardTitle>
          <CardDescription>Download your training data for backup or analysis</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={() => {
                window.location.href = "/api/export?format=csv";
              }}
              data-testid="button-export-csv"
            >
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Export as CSV
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                window.location.href = "/api/export?format=json";
              }}
              data-testid="button-export-json"
            >
              <FileJson className="h-4 w-4 mr-2" />
              Export as JSON
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            CSV includes your workout history. JSON includes full data with training plans.
          </p>
        </CardContent>
      </Card>

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
