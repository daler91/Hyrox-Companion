import type { NutritionMacroTotals } from "@shared/schema";
import { UtensilsCrossed } from "lucide-react";
import type { ReactNode } from "react";

import { useSessionFuelling } from "@/hooks/useNutrition";
import { cn } from "@/lib/utils";

import { PostTargetLine, PreCarbTargetLine } from "./fuelling/targetLines";

const MACRO_CHIPS: ReadonlyArray<{ key: keyof NutritionMacroTotals; label: string }> = [
  { key: "calories", label: "kcal" },
  { key: "protein", label: "P" },
  { key: "carb", label: "C" },
  { key: "fat", label: "F" },
];

function MacroChips({
  totals,
  emphasizeProtein = false,
  testId,
}: {
  readonly totals: NutritionMacroTotals;
  readonly emphasizeProtein?: boolean;
  readonly testId: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" data-testid={testId}>
      {MACRO_CHIPS.map((m) => (
        <span
          key={m.key}
          className={cn(
            "rounded-md bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground",
            emphasizeProtein && m.key === "protein" && "bg-primary/15 font-semibold text-primary",
          )}
        >
          <span className="font-medium text-foreground">{totals[m.key]}</span> {m.label}
        </span>
      ))}
    </div>
  );
}

function FuellingGroup({
  title,
  count,
  totals,
  emphasizeProtein,
  testId,
  targetLine,
}: {
  readonly title: string;
  readonly count: number;
  readonly totals: NutritionMacroTotals;
  readonly emphasizeProtein?: boolean;
  readonly testId: string;
  readonly targetLine?: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">
        {title}
        {count > 0 ? ` · ${count} item${count === 1 ? "" : "s"}` : ""}
      </p>
      {count > 0 ? (
        <MacroChips totals={totals} emphasizeProtein={emphasizeProtein} testId={testId} />
      ) : (
        <p className="text-xs text-muted-foreground/70">Nothing logged</p>
      )}
      {targetLine}
    </div>
  );
}

/**
 * FR-3.4 + Phase 3 — fuelling context on a workout record. Shows what the athlete
 * ate in the pre-session (carb-forward) and post-session (protein/recovery)
 * windows around the workout, and — new in Phase 3 — the recommended fuelling for
 * the session and how far the logged intake is from it. The caller gates on
 * `featureFlags.nutritionEnabled && entry.workoutLogId`.
 */
export function FuellingAroundSessionPanel({ workoutLogId }: { readonly workoutLogId: string }) {
  const { data, isLoading, isError } = useSessionFuelling(workoutLogId);

  // Don't clutter the sheet if the fuelling lookup failed — it's supplementary.
  if (isError) return null;

  const target = data?.target ?? null;
  const gap = data?.gap ?? null;

  const preTarget = target ? (
    <PreCarbTargetLine
      preCarbG={target.preCarbG}
      remaining={gap?.preCarbG}
      showRemaining
      testId="fuelling-pre-target"
    />
  ) : undefined;

  const postTarget = target ? (
    <PostTargetLine
      postCarbG={target.postCarbG}
      postProteinG={target.postProteinG}
      carbRemaining={gap?.postCarbG}
      proteinRemaining={gap?.postProteinG}
      showRemaining
      testId="fuelling-post-target"
    />
  ) : undefined;

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm" data-testid="fuelling-panel">
      <div className="flex items-center gap-2">
        <UtensilsCrossed className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Fuelling around this session</h3>
      </div>

      {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}

      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <FuellingGroup
              title="Pre-session fuelling"
              count={data.pre.length}
              totals={data.preTotals}
              testId="fuelling-pre-totals"
              targetLine={preTarget}
            />
            <FuellingGroup
              title="Post-session recovery"
              count={data.post.length}
              totals={data.postTotals}
              emphasizeProtein
              testId="fuelling-post-totals"
              targetLine={postTarget}
            />
          </div>

          {target && (
            <p
              className="text-[11px] text-muted-foreground/70"
              title={target.explanation}
              data-testid="fuelling-guidance"
            >
              Targets are guidance based on this session.
            </p>
          )}

          {!data.usedStartTime && (
            <p className="text-[11px] text-muted-foreground/80" data-testid="fuelling-fallback-note">
              Based on your pre/post-workout meal tags. Connect Strava or Garmin for exact session timing.
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}
