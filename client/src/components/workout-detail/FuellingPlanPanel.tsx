import { estimatePlannedSession } from "@shared/plannedSessionEstimate";
import type { TimelineEntry } from "@shared/schema";
import { computeSessionFuellingTarget } from "@shared/sessionFuellingTargets";
import { useQuery } from "@tanstack/react-query";
import { UtensilsCrossed } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { RpeSelector } from "@/components/RpeSelector";
import { NumberStepper } from "@/components/ui/number-stepper";
import { useApiMutation } from "@/hooks/useApiMutation";
import { api, QUERY_KEYS, type UserPreferences } from "@/lib/api";

import { PostTargetLine, PreCarbTargetLine } from "./fuelling/targetLines";

interface ExpectedSessionUpdate {
  expectedDurationMin?: number | null;
  expectedRpe?: number | null;
}

function planHint(opts: {
  noBodyweight: boolean;
  hasDuration: boolean;
  usingEstimate: boolean;
}): { testId: string; text: string } | null {
  if (opts.noBodyweight) {
    return {
      testId: "fuelling-plan-bodyweight-hint",
      text: "Set your bodyweight in Settings for targets tailored to you.",
    };
  }
  if (!opts.hasDuration) {
    return {
      testId: "fuelling-plan-hint",
      text: "Add exercises or set an expected duration for a tailored plan.",
    };
  }
  if (opts.usingEstimate) {
    return {
      testId: "fuelling-plan-estimate-note",
      text: "Estimated from your planned exercises — adjust below to fine-tune.",
    };
  }
  return null;
}

/**
 * Phase 3b — pre-session fuelling target on a PLANNED workout (Preview + Log
 * sheets). The session's duration/intensity are seeded from the already-saved
 * exercise table (`estimatePlannedSession`) and from any expected values the
 * athlete saved on the plan day, then fed to the shared `computeSessionFuellingTarget`.
 * Editing duration/effort persists to the plan day so the target is remembered.
 * The caller gates on `featureFlags.nutritionEnabled && entry.planDayId`.
 */
export function FuellingPlanPanel({ entry }: { readonly entry: TimelineEntry }) {
  const { data: preferences } = useQuery<UserPreferences>({ queryKey: QUERY_KEYS.preferences });
  const bodyweightKg = preferences?.bodyweightKg ?? null;

  const estimate = useMemo(
    () =>
      estimatePlannedSession({
        structureBlocks: entry.structureBlocks ?? [],
        exerciseSets: entry.exerciseSets ?? [],
      }),
    [entry.structureBlocks, entry.exerciseSets],
  );

  // Saved expected values win; otherwise seed from the exercise-table estimate.
  const [durationDraft, setDurationDraft] = useState<number | undefined>(
    entry.expectedDurationMin ?? estimate.durationMin ?? undefined,
  );
  const [rpeDraft, setRpeDraft] = useState<number | null>(
    entry.expectedRpe ?? estimate.rpe ?? null,
  );

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const mutation = useApiMutation({
    mutationFn: (updates: ExpectedSessionUpdate) =>
      api.plans.updateDayWithoutPlan(entry.planDayId ?? "", updates as Record<string, unknown>),
    invalidateQueries: [QUERY_KEYS.timeline],
    errorToast: "Couldn't save your expected session details",
  });

  // Debounce so rapid stepper clicks coalesce into one PATCH (rate-limited 20/min).
  const persist = (updates: ExpectedSessionUpdate) => {
    if (!entry.planDayId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => mutation.mutate(updates), 500);
  };

  const target = useMemo(
    () =>
      computeSessionFuellingTarget({
        durationMin: durationDraft ?? null,
        rpe: rpeDraft,
        bodyweightKg,
      }),
    [durationDraft, rpeDraft, bodyweightKg],
  );

  const hint = planHint({
    noBodyweight: target.reasonCodes.includes("no_bodyweight_defaults"),
    hasDuration: durationDraft != null,
    usingEstimate: entry.expectedDurationMin == null && estimate.source !== "none",
  });

  return (
    <section className="space-y-3 rounded-md border bg-card p-3" data-testid="fuelling-plan-panel">
      <div className="flex items-center gap-2">
        <UtensilsCrossed className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Fuel for this session</h3>
      </div>

      <div className="space-y-1">
        <PreCarbTargetLine preCarbG={target.preCarbG} testId="fuelling-plan-pre-target" />
        <PostTargetLine
          postCarbG={target.postCarbG}
          postProteinG={target.postProteinG}
          testId="fuelling-plan-post-target"
        />
      </div>

      {hint && (
        <p className="text-[11px] text-muted-foreground/80" data-testid={hint.testId}>
          {hint.text}
        </p>
      )}

      <div className="space-y-2 border-t pt-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-muted-foreground">Expected duration (min)</span>
          <NumberStepper
            value={durationDraft}
            onChange={(value) => {
              setDurationDraft(value);
              persist({ expectedDurationMin: value ?? null });
            }}
            min={1}
            max={600}
            stepOptions={[5, 15]}
            placeholder="min"
            ariaLabel="Expected duration in minutes"
            testId="fuelling-plan-duration"
            className="w-32"
          />
        </div>
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Expected effort</span>
          <RpeSelector
            value={rpeDraft}
            onChange={(value) => {
              setRpeDraft(value);
              persist({ expectedRpe: value });
            }}
            showLabel={false}
            compact
          />
        </div>
      </div>

      <p
        className="text-[11px] text-muted-foreground/70"
        title={target.explanation}
        data-testid="fuelling-plan-guidance"
      >
        Targets are guidance based on this session.
      </p>
    </section>
  );
}
