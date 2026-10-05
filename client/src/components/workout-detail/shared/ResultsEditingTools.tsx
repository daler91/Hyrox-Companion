import { ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";

/**
 * The workout description (with scan / parse) and the structure builder under
 * the results. With no rows yet they are how the athlete fills the workout in,
 * so they start open; once rows exist they fold into one quiet line. A native
 * <details> hides rather than unmounts, so the autosaving description and the
 * structure editor keep their pending saves whether it is open or shut — and
 * the same tree renders either way, so rows landing never remounts them.
 *
 * Open while the workout has no rows, and otherwise as the athlete leaves it.
 * It used to follow "no rows" directly, so adding the first block, from which
 * the server derives a row, closed it under the athlete mid-edit. Losing every
 * row still opens it. CL14 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function ResultsEditingTools({
  openWhileEmpty,
  children,
}: {
  readonly openWhileEmpty: boolean;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(openWhileEmpty);
  const [trackedOpenWhileEmpty, setTrackedOpenWhileEmpty] = useState(openWhileEmpty);
  if (openWhileEmpty !== trackedOpenWhileEmpty) {
    setTrackedOpenWhileEmpty(openWhileEmpty);
    if (openWhileEmpty) setOpen(true);
  }
  return (
    <details
      className="group"
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
      data-testid="review-editing-tools"
    >
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="h-3.5 w-3.5 transition-transform group-open:rotate-90"
          aria-hidden
        />
        Description &amp; structure
      </summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  );
}
