import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Link2, RefreshCw, Unlink } from "lucide-react";
import { SiStrava } from "react-icons/si";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDistanceToNow } from "date-fns";

interface StravaStatus {
  connected: boolean;
  athleteId?: string;
  lastSyncedAt?: string | null;
}

interface StravaSectionProps {
  stravaStatus: StravaStatus | undefined;
  stravaLoading: boolean;
}

export function StravaSection({ stravaStatus, stravaLoading }: Readonly<StravaSectionProps>) {
  const { toast } = useToast();

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

  return (
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
  );
}
