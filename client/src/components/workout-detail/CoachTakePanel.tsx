import { ArrowRight, Loader2, RefreshCw, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

interface CoachTakePanelProps {
  readonly rationale: string | null | undefined;
  readonly onAskCoach?: () => void;
  /**
   * True when the exercise prescription has been edited since this rationale
   * was generated. When set, the panel shows a small "exercises changed" hint
   * plus a Refresh button that regenerates the note. Only passed on planned
   * entries — logged workouts have their own post-workout coach flow.
   */
  readonly isStale?: boolean;
  /** Click handler for the Refresh button. Omit to hide the button. */
  readonly onRefresh?: () => void;
  /** True while the regenerate Gemini call is in flight. */
  readonly isRefreshing?: boolean;
  /**
   * True while the server-side 30-second cooldown window is active. Button
   * disabled in this state so the user can't queue a guaranteed-429 request.
   */
  readonly isCoolingDown?: boolean;
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
  onRefresh,
  isRefreshing,
  isCoolingDown,
}: CoachTakePanelProps) {
  if (!rationale) return null;

  const showRefresh = Boolean(onRefresh);
  const refreshDisabled = Boolean(isRefreshing || isCoolingDown);

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-green-500/30 bg-green-500/5 p-4"
      aria-label="Coach's take on this workout"
      data-testid="coach-take-panel"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-green-800 dark:text-green-400">
          <Sparkles className="size-3.5" aria-hidden />
          Coach take
        </div>
        {showRefresh && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={refreshDisabled}
            className="h-7 gap-1 text-xs text-muted-foreground"
            aria-label={isRefreshing ? "Refreshing coach note" : "Refresh coach note"}
            data-testid="coach-take-refresh"
          >
            {isRefreshing ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-3" aria-hidden />
            )}
            Refresh
          </Button>
        )}
      </div>
      {isStale && !isRefreshing && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="coach-take-stale-hint"
          aria-live="polite"
        >
          Exercises changed since this note — refresh to update.
        </p>
      )}
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
