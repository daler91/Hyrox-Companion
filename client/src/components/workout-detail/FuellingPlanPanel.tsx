import { estimatePlannedSession } from "@shared/plannedSessionEstimate";
import type { TimelineEntry } from "@shared/schema";
import { computeSessionFuellingTarget } from "@shared/sessionFuellingTargets";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, UtensilsCrossed } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { RpeSelector } from "@/components/RpeSelector";
import { NumberStepper } from "@/components/ui/number-stepper";
import { useApiMutation } from "@/hooks/useApiMutation";
import { api, QUERY_KEYS, type UserPreferences } from "@/lib/api";
import { hhmmToMinutes, minutesToHhmm } from "@/lib/timeOfDay";

import { PostTargetLine, PreCarbTargetLine } from "./fuelling/targetLines";

interface ExpectedSessionUpdate {
  expectedDurationMin?: number | null;
  expectedRpe?: number | null;
  plannedTimeOfDayMin?: number | null;
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
        distanceUnit: preferences?.distanceUnit ?? null,
      }),
    [entry.structureBlocks, entry.exerciseSets, preferences?.distanceUnit],
  );

  // Saved expected values win; otherwise seed from the exercise-table estimate.
  const [durationDraft, setDurationDraft] = useState<number | undefined>(
    entry.expectedDurationMin ?? estimate.durationMin ?? undefined,
  );
  const [rpeDraft, setRpeDraft] = useState<number | null>(
    entry.expectedRpe ?? estimate.rpe ?? null,
  );
  // Local start time (HH:MM); selects the morning/midday/evening meal timing.
  const [timeOfDay, setTimeOfDay] = useState<string>(minutesToHhmm(entry.plannedTimeOfDayMin));

  // Once the athlete adjusts a field this session, stop auto-applying the async
  // server estimate to it so we never clobber their edit.
  const touchedDuration = useRef(false);
  const touchedRpe = useRef(false);

  // Always-on server estimate: distance-aware, personalized from the athlete's logged
  // run pace, and lightly AI-refined. The local deterministic seed above renders
  // instantly; this swaps in when it resolves. Skipped once both expected values are
  // saved (the override already wins) — keeps it off the AI budget for set sessions.
  const hasBothOverrides = entry.expectedDurationMin != null && entry.expectedRpe != null;
  const { data: serverEstimate } = useQuery({
    queryKey: QUERY_KEYS.nutritionPlannedSessionEstimate(entry.planDayId ?? ""),
    queryFn: () => api.nutrition.getPlannedSessionEstimate(entry.planDayId ?? ""),
    enabled: Boolean(entry.planDayId) && !hasBothOverrides,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!serverEstimate) return;
    if (
      entry.expectedDurationMin == null &&
      !touchedDuration.current &&
      serverEstimate.durationMin != null
    ) {
      setDurationDraft(serverEstimate.durationMin);
    }
    if (entry.expectedRpe == null && !touchedRpe.current && serverEstimate.rpe != null) {
      setRpeDraft(serverEstimate.rpe);
    }
  }, [serverEstimate, entry.expectedDurationMin, entry.expectedRpe]);

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

  const adjustSummary = [
    durationDraft == null ? null : `${durationDraft} min`,
    rpeDraft == null ? null : `RPE ${rpeDraft}`,
    timeOfDay ? `at ${timeOfDay}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm" data-testid="fuelling-plan-panel">
      <div className="flex items-center gap-2">
        <UtensilsCrossed className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Fuel for this session</h3>
      </div>

      <div className="space-y-2">
        <div className="space-y-0.5">
          <p className="text-xs font-medium text-muted-foreground">Before training</p>
          <PreCarbTargetLine preCarbG={target.preCarbG} testId="fuelling-plan-pre-target" />
        </div>
        <div className="space-y-0.5">
          <p className="text-xs font-medium text-muted-foreground">After training</p>
          <PostTargetLine
            postCarbG={target.postCarbG}
            postProteinG={target.postProteinG}
            testId="fuelling-plan-post-target"
          />
        </div>
      </div>

      {hint && (
        <p
          className="text-[11px] text-muted-foreground/80"
          data-testid={hint.testId}
          title={serverEstimate?.refined ? (serverEstimate.rationale ?? undefined) : undefined}
        >
          {hint.text}
        </p>
      )}

      {/* Duration/effort feed the fuel target — collapse them behind a
          disclosure so they don't read like a second RPE-logging input next
          to the "How hard?" selector below. Open by default only when there's
          no duration to estimate from, since the hint asks the user to set one. */}
      <details className="group border-t pt-2" open={durationDraft == null || undefined}>
        <summary
          className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-md text-xs font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
          data-testid="fuelling-plan-adjust"
        >
          <span>Adjust session estimate{adjustSummary ? ` · ${adjustSummary}` : ""}</span>
          <ChevronDown
            className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
            aria-hidden
          />
        </summary>
        <div className="space-y-2 pt-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-muted-foreground">Expected duration (min)</span>
            <NumberStepper
              value={durationDraft}
              onChange={(value) => {
                touchedDuration.current = true;
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
                touchedRpe.current = true;
                setRpeDraft(value);
                persist({ expectedRpe: value });
              }}
              showLabel={false}
              compact
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-muted-foreground">Session time</span>
            <input
              type="time"
              value={timeOfDay}
              onChange={(e) => {
                const next = e.target.value;
                setTimeOfDay(next);
                persist({ plannedTimeOfDayMin: hhmmToMinutes(next) });
              }}
              aria-label="Planned session start time"
              data-testid="fuelling-plan-time"
              className="w-32 rounded-md border bg-background px-2 py-1 text-sm"
            />
          </div>
        </div>
      </details>

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
