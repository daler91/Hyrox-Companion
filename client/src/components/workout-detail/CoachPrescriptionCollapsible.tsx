import { ChevronDown } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface CoachPrescriptionCollapsibleProps {
  readonly mainWorkout: string | null | undefined;
  readonly accessory: string | null | undefined;
  readonly notes: string | null | undefined;
}

/**
 * Minimised read-only view of the coach's free-text prescription — kept
 * around as a fallback while the structured exercises table is the primary
 * source of truth. Starts collapsed so the exercise table gets all the
 * vertical real estate; expand to reference the original prescription.
 *
 * Returns null when there's nothing to display so we don't render an empty
 * accordion for rows that only have structured exercises.
 */
export function CoachPrescriptionCollapsible({
  mainWorkout,
  accessory,
  notes,
}: CoachPrescriptionCollapsibleProps) {
  const hasContent = hasText(mainWorkout) || hasText(accessory) || hasText(notes);
  if (!hasContent) return null;

  return (
    <Collapsible className="rounded-lg border border-border" data-testid="coach-prescription-collapsible">
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground hover:bg-muted/50">
        <span>Coach's prescription</span>
        <ChevronDown
          className={cn(
            "size-4 transition-transform",
            "group-data-[state=open]:rotate-180",
          )}
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3 border-t border-border px-4 py-3 text-sm">
        {hasText(mainWorkout) && <Prescription label="Main" text={mainWorkout!} />}
        {hasText(accessory) && <Prescription label="Accessory" text={accessory!} />}
        {hasText(notes) && <Prescription label="Notes" text={notes!} />}
      </CollapsibleContent>
    </Collapsible>
  );
}

function Prescription({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <p className="whitespace-pre-wrap text-foreground">{text}</p>
    </div>
  );
}

function hasText(v: string | null | undefined): boolean {
  return !!v && v.trim().length > 0;
}
