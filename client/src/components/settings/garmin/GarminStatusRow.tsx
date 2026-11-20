import { Loader2, RefreshCw, Unlink } from "lucide-react";
import { useId } from "react";

import { GarminIcon } from "@/components/icons/GarminIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface GarminStatusRowProps {
  readonly isConnected: boolean;
  readonly hasError: boolean;
  readonly statusText: string;
  /** Why Sync is unavailable right now (Garmin calls are paused), or null. */
  readonly syncPausedText?: string | null;
  readonly isSyncing: boolean;
  readonly isDisconnecting: boolean;
  readonly onSync: () => void;
  readonly onDisconnect: () => void;
}

export function GarminStatusRow({
  isConnected,
  hasError,
  statusText,
  syncPausedText = null,
  isSyncing,
  isDisconnecting,
  onSync,
  onDisconnect,
}: GarminStatusRowProps) {
  const pausedTextId = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-md bg-[#007CC3]/10">
          <GarminIcon className="h-5 w-5 text-[#007CC3]" aria-hidden="true" />
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
          {syncPausedText && (
            <p id={pausedTextId} className="text-sm text-muted-foreground" data-testid="text-garmin-sync-paused">
              {syncPausedText}
            </p>
          )}
        </div>
      </div>
      {isConnected && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onSync}
            disabled={isSyncing || syncPausedText !== null}
            aria-busy={isSyncing}
            aria-describedby={syncPausedText ? pausedTextId : undefined}
            data-testid="button-sync-garmin"
          >
            {isSyncing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            )}
            <span className="ml-1.5">{isSyncing ? "Syncing…" : "Sync"}</span>
          </Button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
                  onClick={(e) => {
                    if (isDisconnecting) e.preventDefault();
                    else onDisconnect();
                  }}
                  aria-disabled={isDisconnecting}
                  aria-label={isDisconnecting ? "Disconnecting Garmin…" : "Disconnect Garmin"}
                  aria-busy={isDisconnecting}
                  data-testid="button-disconnect-garmin"
                >
                  {isDisconnecting ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Unlink className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Disconnect Garmin</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}
    </div>
  );
}
