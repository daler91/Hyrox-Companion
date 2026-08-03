import { useQuery } from "@tanstack/react-query";
import { Bell, BellOff, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useApiMutation } from "@/hooks/useApiMutation";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { api, QUERY_KEYS, type UpdateUserPreferencesPayload, type UserPreferences } from "@/lib/api";
import { featureFlags } from "@/lib/featureFlags";

/** The two opt-in nutrition push reminders, shown once push is enabled. */
function NutritionReminderToggles() {
  const { data: prefs } = useQuery<UserPreferences>({ queryKey: QUERY_KEYS.preferences });
  const update = useApiMutation<unknown, Error, UpdateUserPreferencesPayload>({
    mutationFn: (data) => api.preferences.update(data),
    invalidateQueries: [QUERY_KEYS.preferences],
    errorToast: "Couldn't update reminder settings",
  });

  return (
    <div className="space-y-3 border-t pt-3">
      <p className="text-sm font-medium">Nutrition reminders</p>

      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="push-refuel-reminder" className="cursor-pointer text-sm">
            Post-workout refuel
          </Label>
          <p className="text-xs text-muted-foreground">
            A nudge after a session while recovery carbs and protein are still owed.
          </p>
        </div>
        <Switch
          id="push-refuel-reminder"
          checked={prefs?.pushRefuelReminder ?? false}
          onCheckedChange={(v) => update.mutate({ pushRefuelReminder: v })}
          disabled={update.isPending || !prefs}
          data-testid="switch-push-refuel-reminder"
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="push-logging-reminder" className="cursor-pointer text-sm">
            Evening logging reminder
          </Label>
          <p className="text-xs text-muted-foreground">
            An 8pm nudge on days where nothing has been logged yet.
          </p>
        </div>
        <Switch
          id="push-logging-reminder"
          checked={prefs?.pushLoggingReminder ?? false}
          onCheckedChange={(v) => update.mutate({ pushLoggingReminder: v })}
          disabled={update.isPending || !prefs}
          data-testid="switch-push-logging-reminder"
        />
      </div>
    </div>
  );
}

export function PushNotificationSection() {
  const { toast } = useToast();
  const {
    isSupported,
    isSubscribed,
    permission,
    isLoading,
    subscribe,
    unsubscribe,
    sendTestNotification,
  } = usePushNotifications();

  if (!isSupported) {
    return (
      <Card>
        <CardHeader>
          <CardTitle as="h2" className="flex items-center gap-2">
            <BellOff className="h-5 w-5 text-muted-foreground" />
            Push Notifications
          </CardTitle>
          <CardDescription>Push notifications are not supported in this browser.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const handleSubscribe = async () => {
    const success = await subscribe();
    if (success) {
      toast({ title: "Push notifications enabled" });
    } else if (permission === "denied") {
      toast({
        title: "Notifications blocked",
        description: "Please allow notifications in your browser settings.",
        variant: "destructive",
      });
    }
  };

  const handleUnsubscribe = async () => {
    const success = await unsubscribe();
    if (success) {
      toast({ title: "Push notifications disabled" });
    }
  };

  const handleToggle = (checked: boolean) => {
    void (checked ? handleSubscribe() : handleUnsubscribe());
  };

  const handleTest = async () => {
    const success = await sendTestNotification();
    if (success) {
      toast({ title: "Test notification sent" });
    } else {
      toast({ title: "Failed to send test notification", variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-primary" />
          Push Notifications
        </CardTitle>
        <CardDescription>
          Get notified about training reminders and coaching updates directly in your browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="push-notifications-switch" className="cursor-pointer">
              Enable Push Notifications
            </Label>
            <p className="text-sm text-muted-foreground">
              Receive instant alerts for missed workouts and AI coaching updates
            </p>
          </div>
          <Switch
            id="push-notifications-switch"
            checked={isSubscribed}
            onCheckedChange={handleToggle}
            disabled={isLoading}
            data-testid="switch-push-notifications"
          />
        </div>

        {isSubscribed && featureFlags.nutritionEnabled && <NutritionReminderToggles />}

        {isSubscribed && (
          <div className="flex items-center justify-between gap-4 pt-2 border-t">
            <div className="space-y-1">
              <Label className="text-sm">Test Notification</Label>
              <p className="text-xs text-muted-foreground">Send a test to verify it works</p>
            </div>
            <Button variant="outline" size="sm" onClick={handleTest} data-testid="button-test-push">
              <Send className="h-3.5 w-3.5 mr-1.5" />
              Test
            </Button>
          </div>
        )}

        {permission === "denied" && (
          <p className="text-sm text-destructive" role="alert">
            Notifications are blocked in your browser. Please update your browser settings to enable
            them.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
