import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface DeltaIndicatorProps {
  /** Current-period value. */
  readonly current: number;
  /** Previous-period value. */
  readonly previous: number;
  /**
   * When true, a decrease is styled positively (e.g. average RPE going
   * down is a sign of recovery, not a regression). Defaults to false.
   */
  readonly lowerIsBetter?: boolean;
  /**
   * Unit suffix for the absolute delta tooltip. Defaults to empty.
   * The percentage display is always unit-less.
   */
  readonly unit?: string;
  /** Test id suffix for the wrapping element. */
  readonly testIdSuffix?: string;
}

/**
 * Small arrow + percentage pill that sits beside an Analytics Overview
 * stat. Compares a current-period value against the equivalent
 * previous-period value and shows:
 *
 * - ↑ green "+N%" when the metric improved
 * - ↓ green "-N%" when the metric improved and `lowerIsBetter` is set
 * - ↑/↓ red otherwise (regressed metric)
 * - → muted "=" when the two values are within 0.5%
 *
 * Returns null when the previous value is zero AND the current value is
 * zero (nothing meaningful to compare). When previous is zero but current
 * is non-zero the pill renders a muted "new" label instead of a divide-by-
 * zero percentage.
 */
export function DeltaIndicator({
  current,
  previous,
  lowerIsBetter = false,
  unit = "",
  testIdSuffix,
}: DeltaIndicatorProps) {
  if (previous === 0 && current === 0) return null;

  if (previous === 0) {
    const tip = `Previous period: 0${unit} → Current: ${current}${unit}`;
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              className="inline-flex items-center gap-0.5 text-[10px] font-medium text-muted-foreground rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              data-testid={testIdSuffix ? `delta-new-${testIdSuffix}` : undefined}
              aria-label={`New metric: ${current}${unit}`}
            >
              new
            </span>
          </TooltipTrigger>
          <TooltipContent><p>{tip}</p></TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const percent = ((current - previous) / previous) * 100;
  const absRaw = Math.abs(percent);

  // Treat anything within 0.5 percentage points as flat — avoids noisy
  // 0.1% changes that don't reflect meaningful user progress. The check
  // runs on the unrounded value so that 0.45%–0.49% aren't rounded up to
  // 0.5% and mistakenly shown as regressions/improvements.
  if (absRaw < 0.5) {
    const tip = `No meaningful change vs previous period (${previous}${unit} → ${current}${unit})`;
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              className="inline-flex items-center gap-0.5 text-[10px] font-medium text-muted-foreground rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              data-testid={testIdSuffix ? `delta-flat-${testIdSuffix}` : undefined}
              aria-label={`Unchanged at ${current}${unit} vs previous period`}
            >
              <ArrowRight className="h-2.5 w-2.5" aria-hidden="true" />
              =
            </span>
          </TooltipTrigger>
          <TooltipContent><p>{tip}</p></TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const absPercent = Math.round(absRaw * 10) / 10;
  const isIncrease = percent > 0;
  // An increase is "good" when higher is better, OR when lower is better but
  // the metric went down. XOR captures this succinctly.
  const isImprovement = isIncrease !== lowerIsBetter;
  const Arrow = isIncrease ? ArrowUp : ArrowDown;
  const direction = isImprovement ? "up" : "down";

  const tip = `Previous period: ${previous}${unit} → Current: ${current}${unit}`;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className={cn(
              "inline-flex items-center gap-0.5 text-[10px] font-medium rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              isImprovement ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
            )}
            data-testid={testIdSuffix ? `delta-${direction}-${testIdSuffix}` : undefined}
            aria-label={`${isImprovement ? "Improved" : "Regressed"} by ${absPercent}% vs previous period`}
          >
            <Arrow className="h-2.5 w-2.5" aria-hidden="true" />
            {absPercent}%
          </span>
        </TooltipTrigger>
        <TooltipContent><p>{tip}</p></TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
