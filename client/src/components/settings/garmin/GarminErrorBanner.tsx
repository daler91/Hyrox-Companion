import { AlertTriangle } from "lucide-react";

interface GarminErrorBannerProps {
  readonly error: string | null | undefined;
}

export function GarminErrorBanner({ error }: GarminErrorBannerProps) {
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-medium">Garmin sync is broken</p>
          <p className="mt-1 text-destructive/80">{error}</p>
        </div>
      </div>
    </div>
  );
}
