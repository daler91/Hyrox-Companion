import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

interface LoadingSpinnerProps {
  /** Visible label for screen readers; still visually hidden. */
  label?: string;
  /** Tailwind size class for the icon, e.g. "h-4 w-4" or "h-8 w-8". */
  iconClassName?: string;
  /** Wrapper className. Use to position/center the spinner. */
  className?: string;
  /**
   * If true, the live region announces assertively. Default polite.
   * Use for blocking work the user is actively waiting on.
   */
  assertive?: boolean;
}

/**
 * Accessible loading indicator. Wraps Loader2 in a status live region so
 * assistive tech announces async work. Per WCAG 4.1.3 Status Messages.
 *
 * Visual styling kept identical to the previous ad-hoc <Loader2 ... /> so
 * it can drop in without layout regressions.
 */
export function LoadingSpinner({
  label = "Loading",
  iconClassName = "h-8 w-8",
  className,
  assertive = false,
}: Readonly<LoadingSpinnerProps>) {
  return (
    <div
      role="status"
      aria-live={assertive ? "assertive" : "polite"}
      className={cn("inline-flex items-center justify-center", className)}
    >
      <Loader2
        aria-hidden="true"
        className={cn("animate-spin text-muted-foreground", iconClassName)}
      />
      <span className="sr-only">{label}</span>
    </div>
  );
}
