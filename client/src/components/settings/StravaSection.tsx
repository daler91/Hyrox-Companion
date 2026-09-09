import { formatDistanceToNow } from "date-fns";
import { Link2, Loader2, RefreshCw, Unlink } from "lucide-react";
import { useState } from "react";

import { StravaIcon } from "@/components/icons/StravaIcon";
import { ConfirmDialog } from "@/components/timeline/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useStravaMutations } from "@/hooks/useStravaMutations";
import type { StravaAutoSyncInfo, StravaStatus } from "@/lib/api";

interface StravaSectionProps {
  readonly stravaStatus: StravaStatus | undefined;
  readonly stravaLoading: boolean;
}

type StravaMutations = ReturnType<typeof useStravaMutations>;

/** "every hour", "every 30 minutes", "every 2 hours". */
function describeInterval(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "every hour" : `every ${hours} hours`;
  }
  return `every ${minutes} minutes`;
}

/**
 * The second line under the "Strava" label: what happens without pressing
 * Sync. Nothing for a server that predates automatic sync or has it switched
 * off, so the section then reads exactly as it used to.
 */
function describeAutoSync(
  autoSync: StravaAutoSyncInfo | undefined,
  connected: boolean,
): string | null {
  if (!autoSync?.enabled) return null;
  if (!connected) return "Connect once — new activities then sync automatically.";
  if (autoSync.webhook) {
    return "New activities sync automatically, usually within a minute of finishing.";
  }
  return `New activities sync automatically — checked ${describeInterval(autoSync.intervalMinutes)}.`;
}

export interface StravaStatusCopy {
  status: string;
  hint: string | null;
}

/** The prose under the "Strava" label. Exported for tests. */
export function describeStravaStatus(
  stravaStatus: StravaStatus | undefined,
  requiresReauth: boolean,
): StravaStatusCopy {
  if (requiresReauth) {
    return { status: "Strava access was revoked. Reconnect to resume syncing.", hint: null };
  }
  const autoSync = stravaStatus?.autoSync;
  if (!stravaStatus?.connected) {
    return { status: "Import activities from Strava", hint: describeAutoSync(autoSync, false) };
  }
  const hint = describeAutoSync(autoSync, true);
  if (!stravaStatus.lastSyncedAt) {
    // The first import is queued the moment the OAuth callback lands, so a
    // connected-but-unsynced row means it is on its way (or the polling
    // fallback will get to it), not that nothing will happen.
    return { status: hint ? "Importing your recent activities…" : "Not yet synced", hint };
  }
  return {
    status: `Last synced ${formatDistanceToNow(new Date(stravaStatus.lastSyncedAt), { addSuffix: true })}`,
    hint,
  };
}

export function StravaSection({ stravaStatus, stravaLoading }: Readonly<StravaSectionProps>) {
  const mutations = useStravaMutations();
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);

  const requiresReauth = Boolean(stravaStatus?.connected && stravaStatus.requiresReauth);
  const { status: statusText, hint: autoSyncHint } = describeStravaStatus(
    stravaStatus,
    requiresReauth,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2">
          <Link2 className="h-5 w-5" aria-hidden="true" />
          Integrations
        </CardTitle>
        <CardDescription>Connect external services to sync your workouts</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-md bg-[#FC4C02]/10">
              <StravaIcon className="h-5 w-5 text-[#FC4C02]" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label>Strava</Label>
                <StravaStatusBadge
                  requiresReauth={requiresReauth}
                  connected={Boolean(stravaStatus?.connected)}
                />
              </div>
              <p className="text-sm text-muted-foreground" data-testid="text-strava-status">
                {statusText}
              </p>
              {autoSyncHint && (
                <p className="text-xs text-muted-foreground" data-testid="text-strava-auto-sync">
                  {autoSyncHint}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StravaActions
              connected={Boolean(stravaStatus?.connected)}
              requiresReauth={requiresReauth}
              stravaLoading={stravaLoading}
              mutations={mutations}
              onRequestDisconnect={() => setDisconnectConfirmOpen(true)}
            />
          </div>
        </div>
      </CardContent>
      <ConfirmDialog
        open={disconnectConfirmOpen}
        onOpenChange={setDisconnectConfirmOpen}
        title="Disconnect Strava?"
        description="Your synced activities will remain, but new workouts will no longer be imported from Strava."
        confirmText="Disconnect"
        onConfirm={() => {
          mutations.disconnectStravaMutation.mutate();
          setDisconnectConfirmOpen(false);
        }}
        isPending={mutations.disconnectStravaMutation.isPending}
        isDestructive
        confirmTestId="button-confirm-disconnect-strava"
      />
    </Card>
  );
}

function StravaStatusBadge({
  requiresReauth,
  connected,
}: Readonly<{ requiresReauth: boolean; connected: boolean }>) {
  if (requiresReauth) {
    return (
      <Badge variant="destructive" className="text-xs">
        Reconnect needed
      </Badge>
    );
  }
  if (!connected) return null;
  return (
    <Badge variant="outline" className="text-xs">
      Connected
    </Badge>
  );
}

interface StravaActionsProps {
  readonly connected: boolean;
  readonly requiresReauth: boolean;
  readonly stravaLoading: boolean;
  readonly mutations: StravaMutations;
  readonly onRequestDisconnect: () => void;
}

function StravaActions({
  connected,
  requiresReauth,
  stravaLoading,
  mutations,
  onRequestDisconnect,
}: Readonly<StravaActionsProps>) {
  if (!connected) {
    return <ConnectStravaButton mutations={mutations} stravaLoading={stravaLoading} />;
  }
  return (
    <>
      <SyncStravaButton requiresReauth={requiresReauth} mutations={mutations} />
      <DisconnectStravaButton mutations={mutations} onRequestDisconnect={onRequestDisconnect} />
    </>
  );
}

function ConnectStravaButton({
  mutations,
  stravaLoading,
}: Readonly<{ mutations: StravaMutations; stravaLoading: boolean }>) {
  const { connectStravaMutation } = mutations;
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => connectStravaMutation.mutate()}
      disabled={connectStravaMutation.isPending || stravaLoading}
      aria-busy={connectStravaMutation.isPending}
      aria-label="Connect Strava"
      data-testid="button-connect-strava"
    >
      {connectStravaMutation.isPending ? (
        <Loader2 className="h-4 w-4 animate-spin mr-1.5" aria-hidden="true" />
      ) : (
        <StravaIcon className="h-4 w-4 mr-1.5 text-[#FC4C02]" aria-hidden="true" />
      )}
      Connect
    </Button>
  );
}

function SyncStravaButton({
  requiresReauth,
  mutations,
}: Readonly<{ requiresReauth: boolean; mutations: StravaMutations }>) {
  const { connectStravaMutation, syncStravaMutation } = mutations;
  if (requiresReauth) {
    // Revoked credentials: syncing can never succeed — offer the
    // OAuth flow again instead (the callback upsert clears the flag).
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => connectStravaMutation.mutate()}
        disabled={connectStravaMutation.isPending}
        aria-busy={connectStravaMutation.isPending}
        aria-label="Reconnect Strava"
        data-testid="button-reconnect-strava"
      >
        {connectStravaMutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <StravaIcon className="h-4 w-4 text-[#FC4C02]" aria-hidden="true" />
        )}
        <span className="ml-1.5">Reconnect</span>
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => syncStravaMutation.mutate()}
      disabled={syncStravaMutation.isPending}
      aria-busy={syncStravaMutation.isPending}
      data-testid="button-sync-strava"
    >
      {syncStravaMutation.isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
      )}
      <span className="ml-1.5">{syncStravaMutation.isPending ? "Syncing…" : "Sync now"}</span>
    </Button>
  );
}

function DisconnectStravaButton({
  mutations,
  onRequestDisconnect,
}: Readonly<{ mutations: StravaMutations; onRequestDisconnect: () => void }>) {
  const { disconnectStravaMutation } = mutations;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRequestDisconnect}
            disabled={disconnectStravaMutation.isPending}
            aria-label={
              disconnectStravaMutation.isPending ? "Disconnecting Strava…" : "Disconnect Strava"
            }
            aria-busy={disconnectStravaMutation.isPending}
            data-testid="button-disconnect-strava"
          >
            {disconnectStravaMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Unlink className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Disconnect Strava</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
