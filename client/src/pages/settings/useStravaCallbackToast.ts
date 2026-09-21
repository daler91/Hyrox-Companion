import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";

import { useToast } from "@/hooks/use-toast";

/**
 * Handles the `?strava=connected` / `?strava=error` OAuth callback params:
 * shows the matching toast, lands the user on the Integrations tab and strips
 * the callback param from the URL (the tab survives via the query string).
 */
export function useStravaCallbackToast(landOnIntegrations: () => void) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const search = useSearch();

  useEffect(() => {
    const params = new URLSearchParams(search);
    const stravaResult = params.get("strava");
    if (stravaResult !== "connected" && stravaResult !== "error") {
      return;
    }
    if (stravaResult === "connected") {
      toast({
        title: "Strava Connected",
        description:
          "Your recent activities are importing now, and new ones will sync automatically.",
      });
    } else {
      toast({
        title: "Connection Failed",
        description: "Failed to connect to Strava. Please try again.",
        variant: "destructive",
      });
    }
    // landOnIntegrations syncs the hook/Tabs state; setLocation strips the
    // param from the URL.
    landOnIntegrations();
    setLocation("/settings?tab=integrations", { replace: true });
  }, [search, toast, setLocation, landOnIntegrations]);
}
