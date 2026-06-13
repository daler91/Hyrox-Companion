import { CheckCircle2 } from "lucide-react";

interface WorkoutContentsStatusProps {
  readonly exerciseCount: number;
  /**
   * Composer path passes an explicit boolean. Sheets leave this undefined
   * and pass a `sourceLabel` instead, from which presence is inferred.
   */
  readonly hasDescription?: boolean;
  /**
   * Sheets: provenance hint shown in the detail slot, e.g. "from coach text".
   * Null hides it and falls back to the generic composer copy.
   */
  readonly sourceLabel?: string | null;
  /** Sheets: appended to the label as "· N block(s)" when greater than 0. */
  readonly structureBlockCount?: number;
  /** Uppercase title; defaults to "Workout contents". */
  readonly summaryLabel?: string;
}

/**
 * One-line "what's captured" summary shared by the log-workout composer and
 * the sheet-native workout editors. It orients the user before they scan the
 * exercise rows: how many exercises, whether there's source text behind them,
 * and how many timed structure blocks exist.
 *
 * Extracted from WorkoutComposer so the sheet surfaces (LogSheet,
 * AdhocLogSheet, ReviewSurface) can reuse the exact same strip via
 * WorkoutContentsLayout.
 */
export function WorkoutContentsStatus({
  exerciseCount,
  hasDescription,
  sourceLabel = null,
  structureBlockCount = 0,
  summaryLabel = "Workout contents",
}: WorkoutContentsStatusProps) {
  const hasSource = hasDescription ?? sourceLabel !== null;

  let label = "Empty";
  let detail = "Add exercise rows or a description";
  if (exerciseCount > 0) {
    label = `${exerciseCount} exercise${exerciseCount === 1 ? "" : "s"}`;
    detail = sourceLabel ?? (hasSource ? "Structured rows with source text" : "Structured rows ready");
  } else if (hasSource) {
    label = "Description captured";
    detail = "No exercise rows yet";
  }

  if (structureBlockCount > 0) {
    label += ` · ${structureBlockCount} block${structureBlockCount === 1 ? "" : "s"}`;
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
      role="status"
      aria-live="polite"
      data-testid="workout-contents-status"
    >
      <div className="min-w-0">
        <div className="text-xs font-medium uppercase text-muted-foreground">{summaryLabel}</div>
        <div className="truncate font-medium">{label}</div>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {exerciseCount > 0 ? <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden /> : null}
        <span>{detail}</span>
      </div>
    </div>
  );
}
