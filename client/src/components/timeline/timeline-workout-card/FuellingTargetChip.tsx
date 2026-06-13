import { estimatePlannedSession } from "@shared/plannedSessionEstimate";
import type { TimelineEntry } from "@shared/schema";
import { computeSessionFuellingTarget } from "@shared/sessionFuellingTargets";
import { useQuery } from "@tanstack/react-query";
import { UtensilsCrossed } from "lucide-react";
import { useMemo } from "react";

import { QUERY_KEYS, type UserPreferences } from "@/lib/api";

/**
 * Compact pre-session fuelling target on a PLANNED timeline card (Phase 3b).
 * Mirrors the FuellingPlanPanel's inputs — the athlete's saved expected
 * duration/RPE on the plan day, else an estimate from the planned exercise
 * table — so the card and the detail sheet always quote the same number.
 * Renders nothing when the session needs no pre-fuelling (short and easy), so
 * easy days stay uncluttered. The caller gates on the nutrition flag and on
 * the entry being a planned plan-day. Static (not a button): the card itself
 * opens the detail sheet, where the full panel lives.
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

  if (target.preCarbG <= 0) return null;

  return (
    <span
      className="mt-2 inline-flex h-6 items-center gap-1.5 rounded-md border bg-card px-2 text-xs text-muted-foreground"
      title={target.explanation}
      data-testid={`fuelling-target-chip-${entry.id}`}
    >
      <UtensilsCrossed className="h-3 w-3" aria-hidden="true" />
      <span>
        Fuel ~
        <span className="font-medium tabular-nums text-foreground">{target.preCarbG}g</span> carbs
        before
      </span>
    </span>
  );
}
