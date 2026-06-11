import type { EnergyBalanceSummary } from "@shared/schema";
import { Scale } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

/**
 * Phase 4 — the day's energy in vs out on the Nutrition day view. "Out" uses
 * measured training calories when a device provided them (the server prefers
 * Strava/Garmin workout calories over the static activity multiplier) and is
 * labelled accordingly. Renders nothing when the server omitted the block
 * (profile lacks bodyweight/height/age), so behaviour is unchanged for
 * profiles that can't support an honest estimate.
 */
export function EnergyBalanceCard({ energy }: { readonly energy?: EnergyBalanceSummary | null }) {
  if (!energy) return null;

  const surplus = energy.balanceKcal >= 0;
  const balanceText = `${surplus ? "+" : ""}${energy.balanceKcal}`;

  return (
    <Card data-testid="energy-balance-card" title={energy.explanation}>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold">Energy balance</p>
            <p className="text-xs text-muted-foreground" data-testid="energy-basis">
              {energy.basis === "measured"
                ? "Training burn from your logged workouts"
                : "Estimated from your activity level"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm tabular-nums">
          <div className="text-center">
            <p className="font-semibold" data-testid="energy-in">
              {energy.inKcal}
            </p>
            <p className="text-[10px] text-muted-foreground">in (kcal)</p>
          </div>
          <div className="text-center">
            <p className="font-semibold" data-testid="energy-out">
              {energy.outKcal}
            </p>
            <p className="text-[10px] text-muted-foreground">out (kcal)</p>
          </div>
          <div className="text-center">
            <p
              className={`font-semibold ${surplus ? "text-amber-600 dark:text-amber-400" : "text-primary"}`}
              data-testid="energy-balance"
            >
              {balanceText}
            </p>
            <p className="text-[10px] text-muted-foreground">balance</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
