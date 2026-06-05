import { format } from "date-fns";

import { cn } from "@/lib/utils";

interface LastUpdatedNoteProps {
  /** ISO timestamp (datetime mode) or YYYY-MM-DD (date mode). */
  value?: string | null;
  /** Whether newer activity has been logged since `value`. */
  stale?: boolean;
  mode?: "datetime" | "date";
  className?: string;
}

/**
 * Small muted "Last updated …" line shown under the analytics surfaces so it's
 * obvious the result on screen is the previously computed (older) version — and
 * when a workout has been logged since, that a refresh is available.
 */
export function LastUpdatedNote({
  value,
  stale = false,
  mode = "datetime",
  className,
}: Readonly<LastUpdatedNoteProps>) {
  const label = (() => {
    if (!value) return null;
    // Date-only strings are parsed at local midnight so the calendar day is not
    // shifted by the viewer's timezone.
    const parsed = mode === "date" ? new Date(`${value}T00:00:00`) : new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return mode === "date" ? format(parsed, "MMM d, yyyy") : format(parsed, "MMM d, yyyy 'at' h:mm a");
  })();
  if (!label) return null;
  return (
    <p className={cn("text-xs text-muted-foreground", className)} data-testid="analytics-last-updated">
      Last updated {label}.
      {stale ? " New activity since — refresh to update." : ""}
    </p>
  );
}
