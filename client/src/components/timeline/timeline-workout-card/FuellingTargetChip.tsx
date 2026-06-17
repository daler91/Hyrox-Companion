import { estimatePlannedSession } from "@shared/plannedSessionEstimate";
import type { TimelineEntry } from "@shared/schema";
import { computeSessionFuellingTarget } from "@shared/sessionFuellingTargets";
import { useQuery } from "@tanstack/react-query";
import { UtensilsCrossed } from "lucide-react";
import { useMemo } from "react";

import { QUERY_KEYS, type UserPreferences } from "@/lib/api";

/**
 * Compact pre + post fuelling target on a PLANNED timeline card (Phase 3b).
 * Mirrors the FuellingPlanPanel's inputs — the athlete's saved expected
 * duration/RPE on the plan day, else an estimate from the planned exercise
 * table — so the card and the detail sheet always quote the same numbers.
 * Shows the pre-session carbs (when the session is long/hard enough to warrant
 * them) and the post-session recovery carbs + protein, so the card carries the
 * whole fuel plan for the session. Renders nothing only when there's no useful
 * target at all. The caller gates on the nutrition flag and on the entry being a
 * planned plan-day. Static (not a button): the card itself opens the detail
 * sheet, where the full panel lives.
 */
export function FuellingTargetChip({ entry }: { readonly entry: TimelineEntry }) {
  const { data: preferences } = useQuery<UserPreferences>({ queryKey: QUERY_KEYS.preferences });
  const bodyweightKg = preferences?.bodyweightKg ?? null;

  const target = useMemo(() => {
    const estimate = estimatePlannedSession({
      structureBlocks: entry.structureBlocks ?? [],
      exerciseSets: entry.exerciseSets ?? [],
      distanceUnit: preferences?.distanceUnit ?? null,
    });
    return computeSessionFuellingTarget({
      durationMin: entry.expectedDurationMin ?? estimate.durationMin,
      rpe: entry.expectedRpe ?? estimate.rpe,
      bodyweightKg,
    });
  }, [
    entry.structureBlocks,
    entry.exerciseSets,
    entry.expectedDurationMin,
    entry.expectedRpe,
    bodyweightKg,
    preferences?.distanceUnit,
  ]);

  const hasPre = target.preCarbG > 0;
  const hasPost = target.postCarbG > 0 || target.postProteinG > 0;
  if (!hasPre && !hasPost) return null;

  return (
    <span
      className="mt-2 inline-flex h-6 items-center gap-1.5 rounded-md border bg-card px-2 text-xs text-muted-foreground"
      title={target.explanation}
      data-testid={`fuelling-target-chip-${entry.id}`}
    >
      <UtensilsCrossed className="h-3 w-3" aria-hidden="true" />
      <span className="tabular-nums">
        Fuel{" "}
        {hasPre ? (
          <>
            ~<span className="font-medium text-foreground">{target.preCarbG}g</span> carbs before
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
    </span>
  );
}
