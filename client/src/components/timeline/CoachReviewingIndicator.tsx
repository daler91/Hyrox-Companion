import { Loader2, Sparkles } from "lucide-react";

interface CoachReviewingIndicatorProps {
  /** Whether the auto-coach is currently polling for updates. */
  readonly isActive: boolean;
}

/**
 * Persistent status banner that surfaces the background auto-coach work.
 * The `isAutoCoaching` flag is polled via useAuth every 2s and can stay
 * true for up to 5 minutes while Gemini evaluates a completed workout
 * and adjusts upcoming sessions. Without this banner, users had no
 * visible signal that anything was happening in the background.
 */
export function CoachReviewingIndicator({ isActive }: CoachReviewingIndicatorProps) {
  if (!isActive) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="banner-coach-reviewing"
      className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 shadow-sm"
    >
      <div className="relative shrink-0">
        <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
        <Loader2 className="absolute -right-1 -top-1 h-3 w-3 animate-spin text-primary" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">Coach is reviewing your workout</p>
        <p className="text-xs text-muted-foreground">
          Your upcoming sessions may be adjusted. You&apos;ll see updates here shortly.
        </p>
      </div>
    </div>
  );
}
