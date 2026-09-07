import { Info } from "lucide-react";
import type { ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ExplanationTooltipProps {
  /** The full explanation. Shown in the tooltip and read as the trigger's name. */
  readonly explanation: string;
  /**
   * What is being explained, prefixed to the accessible name so the control is
   * identifiable with the tooltip closed. Omit when the trigger's own content
   * already says what it is (a labelled chip, say).
   */
  readonly subject?: string;
  readonly className?: string;
  readonly testId?: string;
  /** Trigger content. Defaults to a small info icon. */
  readonly children?: ReactNode;
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
  children,
}: ExplanationTooltipProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          type="button"
          aria-label={subject ? `${subject}: ${explanation}` : explanation}
          className={cn(
            "inline-flex shrink-0 items-center rounded text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            className,
          )}
          data-testid={testId}
        >
          {children ?? <Info className="h-3.5 w-3.5" aria-hidden="true" />}
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p>{explanation}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
