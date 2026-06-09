/**
 * Shared rendering for per-session fuelling target lines, used by both the
 * completed-workout panel (`FuellingAroundSessionPanel`, which passes the gap vs
 * logged intake) and the planned-workout panel (`FuellingPlanPanel`, target
 * only). Keeping the markup here avoids duplicating the "Aim ~Xg carbs" JSX.
 */

/** "12g to go" when short of the target, "on target" once met (remaining ≤ 0). */
export function gapText(remaining: number | null | undefined): string {
  return remaining != null && remaining > 0 ? `${remaining}g to go` : "on target";
}

interface PreCarbTargetLineProps {
  readonly preCarbG: number;
  /** Remaining carbs vs what's logged; only shown when `showRemaining`. */
  readonly remaining?: number | null;
  readonly showRemaining?: boolean;
  readonly testId: string;
}

export function PreCarbTargetLine({
  preCarbG,
  remaining,
  showRemaining = false,
  testId,
}: PreCarbTargetLineProps) {
  if (preCarbG <= 0) {
    return (
      <p className="text-[11px] text-muted-foreground" data-testid={testId}>
        No pre-fuelling needed
      </p>
    );
  }
  const suffix = showRemaining ? ` (${gapText(remaining)})` : "";
  return (
    <p className="text-[11px] leading-relaxed text-muted-foreground" data-testid={testId}>
      Aim ~<span className="font-medium text-foreground">{preCarbG}g</span> carbs{suffix}
    </p>
  );
}

interface PostTargetLineProps {
  readonly postCarbG: number;
  readonly postProteinG: number;
  readonly carbRemaining?: number | null;
  readonly proteinRemaining?: number | null;
  readonly showRemaining?: boolean;
  readonly testId: string;
}

export function PostTargetLine({
  postCarbG,
  postProteinG,
  carbRemaining,
  proteinRemaining,
  showRemaining = false,
  testId,
}: PostTargetLineProps) {
  const carbSuffix = showRemaining ? ` (${gapText(carbRemaining)})` : "";
  const proteinSuffix = showRemaining ? ` (${gapText(proteinRemaining)})` : "";
  return (
    <p className="text-[11px] leading-relaxed text-muted-foreground" data-testid={testId}>
      Aim ~<span className="font-medium text-foreground">{postCarbG}g</span> carbs{carbSuffix} · ~
      <span className="font-medium text-foreground">{postProteinG}g</span> protein{proteinSuffix}
    </p>
  );
}
