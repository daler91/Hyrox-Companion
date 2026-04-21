import { ArrowRight, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

interface CoachTakePanelProps {
  readonly rationale: string | null | undefined;
  readonly onAskCoach?: () => void;
  /**
   * True when the exercise prescription has been edited since this rationale
   * was generated. The panel shows a small "exercises changed" hint so the
   * athlete knows the note is about to be refreshed (regeneration fires
   * automatically on dialog close via usePlanDayCoachNote).
   */
  readonly isStale?: boolean;
  /** True while the regenerate Gemini call is in flight. */
  readonly isRefreshing?: boolean;
}

/**
 * Right-rail panel showing the AI coach's rationale for this workout
 * (stored on plan_days.aiRationale). The "Ask coach →" button opens the
 * existing CoachPanel; wiring that handoff lives in the dialog parent so
 * this component stays presentational.
 *
 * Returns null when there's no rationale to show — avoids rendering an
 * empty card for non-AI-modified workouts.
 */
export function CoachTakePanel({
  rationale,
  onAskCoach,
  isStale,
  isRefreshing,
}: CoachTakePanelProps) {
  if (!rationale) return null;

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-green-500/30 bg-green-500/5 p-4"
      aria-label="Coach's take on this workout"
      data-testid="coach-take-panel"
    >
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-green-800 dark:text-green-400">
        <Sparkles className="size-3.5" aria-hidden />
        Coach take
      </div>
      {isRefreshing ? (
        <p
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
          data-testid="coach-take-stale-hint"
          aria-live="polite"
        >
          <Loader2 className="size-3 animate-spin" aria-hidden />
          Refreshing coach take…
        </p>
      ) : isStale ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="coach-take-stale-hint"
          aria-live="polite"
        >
          Exercises changed — the coach take will refresh when you close this.
        </p>
      ) : null}
      <p className="text-sm leading-relaxed">{rationale}</p>
      {onAskCoach && (
        <Button
          variant="default"
          size="sm"
          onClick={onAskCoach}
          className="w-fit"
          data-testid="ask-coach-button"
        >
          Ask coach
          <ArrowRight className="ml-1 size-3.5" aria-hidden />
        </Button>
      )}
    </section>
  );
}
