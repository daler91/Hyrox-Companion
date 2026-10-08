import { Info } from "lucide-react";
import { Link } from "wouter";

import { Button } from "@/components/ui/button";

/** Settings' Training tab, where the AI Coach switch lives. */
export const AI_COACH_SETTINGS_HREF = "/settings?tab=training";

interface AiCoachOffNoticeProps {
  /** What the athlete would get with the AI Coach on, e.g. "personalized coach insights". */
  readonly feature: string;
  readonly testId: string;
}

/**
 * Shown beside a disabled "Generate" when the athlete has not opted in to AI
 * processing (the default for new accounts): says why, and links to the
 * switch. Mirrors Race Predictor's consent-off notice.
 * U29 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function AiCoachOffNotice({ feature, testId }: AiCoachOffNoticeProps) {
  return (
    <div
      className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4 text-sm"
      data-testid={testId}
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-2">
        <p className="text-muted-foreground">
          The AI Coach is turned off. Enable it in Settings to get {feature}.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href={AI_COACH_SETTINGS_HREF}>Enable AI Coach</Link>
        </Button>
      </div>
    </div>
  );
}
