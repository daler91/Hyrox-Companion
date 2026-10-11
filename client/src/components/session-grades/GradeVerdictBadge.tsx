import type { SessionGradeVerdict } from "@shared/schema";
import type { SessionGradeIntent } from "@shared/sessionIntent";
import { AlertTriangle, CheckCircle2, CircleHelp, CircleMinus, TrendingDown, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getGradeLabel, getGradeToneClassName } from "@/lib/sessionGradeFormat";
import { cn } from "@/lib/utils";

const ICON_CLASS = "h-3 w-3";

function VerdictIcon({ verdict }: Readonly<{ verdict: SessionGradeVerdict }>) {
  switch (verdict) {
    case "on_target":
      return <CheckCircle2 className={ICON_CLASS} aria-hidden="true" />;
    case "crept_up":
    case "drifted_harder":
      return <TrendingUp className={ICON_CLASS} aria-hidden="true" />;
    case "too_hard":
      return <AlertTriangle className={ICON_CLASS} aria-hidden="true" />;
    case "under":
      return <TrendingDown className={ICON_CLASS} aria-hidden="true" />;
    case "inconclusive":
      return <CircleHelp className={ICON_CLASS} aria-hidden="true" />;
    case "ungradeable":
      return <CircleMinus className={ICON_CLASS} aria-hidden="true" />;
  }
}

/**
 * A session grade's verdict as a chip: tone, icon and words together, so the
 * colour is never the only signal. When a headline is provided, a proper
 * Tooltip surfaces it on touch, keyboard and screen readers — a `title`
 * attribute only fires on mouse hover and is invisible on phones.
 */
export function GradeVerdictBadge({
  intent,
  verdict,
  headline,
  testId,
}: Readonly<{ intent: SessionGradeIntent; verdict: SessionGradeVerdict; headline?: string; testId?: string }>) {
  const label = getGradeLabel(intent, verdict);
  const badge = (
    <Badge
      variant="outline"
      className={cn("gap-1", getGradeToneClassName(verdict))}
      data-testid={testId}
    >
      <VerdictIcon verdict={verdict} />
      {label}
    </Badge>
  );

  if (!headline) return badge;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          type="button"
          className="rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={`${label}: ${headline}`}
        >
          {badge}
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p>{headline}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
