import type { TimelineEntry } from "@shared/schema";
import { isRunningExerciseName } from "@shared/schema/exercises";
import { HeartPulse } from "lucide-react";

import { useMafCeiling } from "@/hooks/useMafCeiling";

/**
 * The athlete's MAF aerobic ceiling on a PLANNED running session — the one
 * moment the number is actually actionable, since MAF is a constraint you hold
 * during the run rather than something you review afterwards.
 *
 * Gated on the session containing running work, read from the exercise
 * definitions rather than `entry.focus`: focus is free LLM text and CSV imports
 * carry arbitrary strings, so matching on it would put a heart-rate ceiling on
 * strength days. The cost is a text-only planned run with no parsed sets getting
 * no chip, which is the right direction to fail in.
 *
 * Static (not a button), matching FuellingTargetChip beside it: the card itself
 * opens the detail sheet. The caller gates on the entry being a planned plan-day.
 */
export function MafCeilingChip({ entry }: { readonly entry: TimelineEntry }) {
  const ceiling = useMafCeiling();

  if (ceiling == null) return null;
  if (!entry.exerciseSets?.some((set) => isRunningExerciseName(set.exerciseName))) return null;

  return (
    <span
      className="mt-2 inline-flex h-6 items-center gap-1.5 rounded-md border bg-card px-2 text-xs text-muted-foreground"
      title={`Your MAF aerobic ceiling is ${ceiling} bpm. Hold at or under it for this run — it's a ceiling to stay below, not a target to chase.`}
      data-testid={`maf-ceiling-chip-${entry.id}`}
    >
      <HeartPulse className="h-3 w-3" aria-hidden="true" />
      <span className="tabular-nums">
        MAF ceiling <span className="font-medium text-foreground">{ceiling}</span> bpm
      </span>
    </span>
  );
}
