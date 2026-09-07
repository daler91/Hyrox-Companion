import { Info } from "lucide-react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ExplanationTooltipProps {
  /** The full explanation. Shown in the tooltip and read as the button's name. */
  readonly explanation: string;
  /** What is being explained, so the control has a name when the tooltip is closed. */
  readonly subject: string;
  readonly className?: string;
  readonly testId?: string;
}

/**
 * A "why is this number what it is" affordance that touch, keyboard and
 * screen-reader users can actually reach.
 *
 * A `title` attribute is mouse-hover only: on a phone nothing happens, tabbing
 * to it is impossible because the element carrying it is not focusable, and
 * screen readers treat it as optional and often skip it. Several fuelling
 * surfaces explained their targets that way, which meant the explanation
 * existed for exactly one input method.
 *
 * The trigger is a real `<button>` (Radix's default) because only a genuinely
 * interactive element may take focus (Sonar S6845) — the same pattern
 * MafCeilingChip and FuellingTargetChip already use.
 */
export function ExplanationTooltip({
  explanation,
  subject,
  className,
  testId,
}: ExplanationTooltipProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          type="button"
          aria-label={`${subject}: ${explanation}`}
          className={cn(
            "inline-flex shrink-0 items-center rounded text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            className,
          )}
          data-testid={testId}
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p>{explanation}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
