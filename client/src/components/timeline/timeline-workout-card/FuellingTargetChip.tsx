import type { PlannedSessionEstimateResponse, TimelineEntry } from "@shared/schema";
import { computeSessionFuellingTarget } from "@shared/sessionFuellingTargets";
import { useQuery } from "@tanstack/react-query";
import { UtensilsCrossed } from "lucide-react";
import { useMemo } from "react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { QUERY_KEYS, type UserPreferences } from "@/lib/api";
import { plannedSessionSeed } from "@/lib/plannedSessionSeed";

/**
 * Compact pre + post fuelling target on a PLANNED timeline card (Phase 3b).
 * Mirrors the FuellingPlanPanel's inputs so the card and the detail sheet quote
 * the same numbers: the athlete's saved expected duration/RPE on the plan day,
 * else the panel's server estimate once the panel has fetched it, else the
 * timeline's pace-personalised `sessionEstimate` (plannedSessionSeed). The chip
 * reads the panel's estimate only from the cache and never fetches it: that
 * would be a request, and maybe an AI call, per planned card (tech debt #59).
 * Shows the pre-session carbs (when the session is long/hard enough to warrant
 * them) and the post-session recovery carbs + protein, so the card carries the
 * whole fuel plan for the session. Renders nothing only when there's no useful
 * target at all. The caller gates on the nutrition flag and on the entry being a
 * planned plan-day. The chip is the tooltip trigger's own <button> (Radix's
 * default) rather than a tabIndex'd span: keyboard and touch users need focus
 * to reveal the explanation, and only a genuinely interactive element may
 * carry that focus (Sonar S6845). Activating it opens nothing itself — the
 * press bubbles to the card, which opens the detail sheet where the full
 * panel lives.
 */
export function FuellingTargetChip({ entry }: { readonly entry: TimelineEntry }) {
  const { data: preferences } = useQuery<UserPreferences>({ queryKey: QUERY_KEYS.preferences });
  const bodyweightKg = preferences?.bodyweightKg ?? null;

  // Cache only (enabled: false): present once the sheet's panel has fetched it.
  const { data: panelEstimate } = useQuery<PlannedSessionEstimateResponse>({
    queryKey: QUERY_KEYS.nutritionPlannedSessionEstimate(entry.planDayId ?? ""),
    enabled: false,
  });

  const target = useMemo(() => {
    const seed = plannedSessionSeed(entry, preferences?.distanceUnit ?? null);
    return computeSessionFuellingTarget({
      durationMin: entry.expectedDurationMin ?? panelEstimate?.durationMin ?? seed.durationMin,
      rpe: entry.expectedRpe ?? panelEstimate?.rpe ?? seed.rpe,
      bodyweightKg,
    });
  }, [entry, panelEstimate, bodyweightKg, preferences?.distanceUnit]);

  const hasPre = target.preCarbG > 0;
  const hasPost = target.postCarbG > 0 || target.postProteinG > 0;
  if (!hasPre && !hasPost) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          type="button"
          className="mt-2 inline-flex min-h-6 max-w-full items-center gap-1.5 rounded-md border bg-card px-2 py-0.5 text-left text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={target.explanation}
          data-testid={`fuelling-target-chip-${entry.id}`}
        >
          <UtensilsCrossed className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="min-w-0 tabular-nums">
            Fuel{" "}
            {hasPre ? (
              <>
                ~<span className="font-medium text-foreground">{target.preCarbG}g</span> carbs
                before
              </>
            ) : null}
            {hasPre && hasPost ? " · " : null}
            {hasPost ? (
              <>
                ~<span className="font-medium text-foreground">{target.postCarbG}g</span> C +{" "}
                <span className="font-medium text-foreground">{target.postProteinG}g</span> P after
              </>
            ) : null}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p>{target.explanation}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
