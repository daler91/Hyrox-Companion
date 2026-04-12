import { formatDistanceToNow } from "date-fns";
import { Link2, Loader2, RefreshCw, Unlink } from "lucide-react";
import { StravaIcon } from "@/components/icons/StravaIcon";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useStravaMutations } from "@/hooks/useStravaMutations";

interface StravaStatus {
  connected: boolean;
  athleteId?: string;
  lastSyncedAt?: string | null;
}

interface StravaSectionProps {
  readonly stravaStatus: StravaStatus | undefined;
  readonly stravaLoading: boolean;
}

export function StravaSection({
  stravaStatus,
  stravaLoading,
}: Readonly<StravaSectionProps>) {
  const {
    connectStravaMutation,
    disconnectStravaMutation,
    syncStravaMutation,
  } = useStravaMutations();

  let statusText = "Import activities from Strava";
  if (stravaStatus?.connected) {
    if (stravaStatus.lastSyncedAt) {
      statusText = `Last synced ${formatDistanceToNow(new Date(stravaStatus.lastSyncedAt), { addSuffix: true })}`;
    } else {
      statusText = "Not yet synced";
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5" />
          Integrations
        </CardTitle>
        <CardDescription>
          Connect external services to sync your workouts
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-md bg-[#FC4C02]/10">
              <StravaIcon className="h-5 w-5 text-[#FC4C02]" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label>Strava</Label>
                {stravaStatus?.connected && (
                  <Badge variant="outline" className="text-xs">
                    Connected
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{statusText}</p>
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
                  aria-label="Disconnect Strava"
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
                  <StravaIcon className="h-4 w-4 mr-1.5 text-[#FC4C02]" />
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
