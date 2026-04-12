import { formatDistanceToNow } from "date-fns";
import { AlertTriangle,Loader2, RefreshCw, Unlink } from "lucide-react";
import { useState } from "react";

import { GarminIcon } from "@/components/icons/GarminIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useGarminMutations } from "@/hooks/useGarminMutations";

interface GarminStatus {
  connected: boolean;
  garminDisplayName?: string | null;
  lastSyncedAt?: string | null;
  lastError?: string | null;
}

interface GarminSectionProps {
  readonly garminStatus: GarminStatus | undefined;
  readonly garminLoading: boolean;
}

export function GarminSection({
  garminStatus,
  garminLoading,
}: Readonly<GarminSectionProps>) {
  const {
    connectGarminMutation,
    disconnectGarminMutation,
    syncGarminMutation,
  } = useGarminMutations();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const isConnected = garminStatus?.connected === true;
  const hasError = isConnected && Boolean(garminStatus?.lastError);

  let statusText = "Import activities from Garmin Connect";
  if (isConnected) {
    if (garminStatus?.lastSyncedAt) {
      statusText = `Last synced ${formatDistanceToNow(new Date(garminStatus.lastSyncedAt), { addSuffix: true })}`;
    } else {
      statusText = "Not yet synced";
    }
  }

  const handleConnect = () => {
    if (!email || !password) return;
    connectGarminMutation.mutate(
      { email, password },
      {
        onSuccess: () => {
          setEmail("");
          setPassword("");
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GarminIcon className="h-5 w-5 text-[#007CC3]" />
          Garmin Connect
        </CardTitle>
        <CardDescription>
          Sync activities from your Garmin device.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-md bg-[#007CC3]/10">
              <GarminIcon className="h-5 w-5 text-[#007CC3]" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label>Garmin</Label>
                {isConnected && !hasError && (
                  <Badge variant="outline" className="text-xs">
                    Connected
                  </Badge>
                )}
                {hasError && (
                  <Badge variant="destructive" className="text-xs">
                    Reconnect needed
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{statusText}</p>
            </div>
          </div>
          {isConnected && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => syncGarminMutation.mutate()}
                disabled={syncGarminMutation.isPending}
                data-testid="button-sync-garmin"
              >
                {syncGarminMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                <span className="ml-1.5">Sync</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => disconnectGarminMutation.mutate()}
                disabled={disconnectGarminMutation.isPending}
                aria-label="Disconnect Garmin"
                data-testid="button-disconnect-garmin"
              >
                {disconnectGarminMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Unlink className="h-4 w-4" />
                )}
              </Button>
            </div>
          )}
        </div>

        {hasError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">Garmin sync is broken</p>
                <p className="mt-1 text-destructive/80">{garminStatus?.lastError}</p>
              </div>
            </div>
          </div>
        )}

        {!isConnected && (
          <div className="space-y-3 pt-2">
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-amber-600" />
                <div className="text-amber-900 dark:text-amber-200">
                  <p className="font-medium">Garmin doesn&apos;t offer OAuth for end users.</p>
                  <p className="mt-1">
                    We have to log in with your email and password against
                    Garmin&apos;s mobile API. Credentials are stored encrypted
                    (AES-256-GCM) but this is materially less secure than
                    OAuth. <strong>2-step verification is not supported</strong>{" "}
                    — you&apos;ll need to disable it on Garmin temporarily to
                    connect.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="garmin-email">Garmin email</Label>
              <Input
                id="garmin-email"
                type="email"
                autoComplete="off"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={connectGarminMutation.isPending || garminLoading}
                data-testid="input-garmin-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="garmin-password">Garmin password</Label>
              <Input
                id="garmin-password"
                type="password"
                autoComplete="off"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={connectGarminMutation.isPending || garminLoading}
                data-testid="input-garmin-password"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleConnect}
              disabled={
                !email ||
                !password ||
                connectGarminMutation.isPending ||
                garminLoading
              }
              data-testid="button-connect-garmin"
            >
              {connectGarminMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <GarminIcon className="h-4 w-4 mr-1.5 text-[#007CC3]" />
              )}
              Connect Garmin
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
