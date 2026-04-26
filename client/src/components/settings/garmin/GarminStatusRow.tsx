import { Loader2, RefreshCw, Unlink } from "lucide-react";

import { GarminIcon } from "@/components/icons/GarminIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

interface GarminStatusRowProps {
  readonly isConnected: boolean;
  readonly hasError: boolean;
  readonly statusText: string;
  readonly isSyncing: boolean;
  readonly isDisconnecting: boolean;
  readonly onSync: () => void;
  readonly onDisconnect: () => void;
}

export function GarminStatusRow({
  isConnected,
  hasError,
  statusText,
  isSyncing,
  isDisconnecting,
  onSync,
  onDisconnect,
}: GarminStatusRowProps) {
  return (
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
            onClick={onSync}
            disabled={isSyncing}
            data-testid="button-sync-garmin"
          >
            {isSyncing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-1.5">Sync</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDisconnect}
            disabled={isDisconnecting}
            aria-label="Disconnect Garmin"
            data-testid="button-disconnect-garmin"
          >
            {isDisconnecting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Unlink className="h-4 w-4" />
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
