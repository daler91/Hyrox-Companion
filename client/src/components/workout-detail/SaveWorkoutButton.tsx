import { Check, Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { SaveFlashBadge } from "./SaveStatePill";

interface SaveWorkoutButtonProps {
  /**
   * True while any save chain is in flight — includes in-flight exercise
   * mutations, the title save, and (when applicable) the coach-note
   * regenerate. The button stays disabled + shows "Saving…" until this
   * settles.
   */
  readonly isBusy: boolean;
  /**
   * Epoch-ms stamp of the most recent successful Save click, or null if
   * the athlete hasn't pressed Save yet this session. Drives the fading
   * "Saved ✓" confirmation keyed on the stamp so each click flashes once.
   */
  readonly savedAt: number | null;
  /**
   * Whether this entry is linked to a plan day. When true the button's
   * subtitle advertises "Updates your coach's take"; when false we keep
   * the label minimal since there's no coach-take to refresh for an
   * ad-hoc logged workout.
   */
  readonly showCoachNoteHint: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}

/**
 * Explicit Save action for the workout detail dialog. Edits still autosave
 * in the background via per-field debounces — this button is the athlete's
 * "I'm done" confirmation. On planned entries the click also fires
 * `usePlanDayCoachNote.regenerate` so the coach's take reflects the
 * just-saved prescription without an automatic side-effect at dialog close.
 */
export function SaveWorkoutButton({
  isBusy,
  savedAt,
  showCoachNoteHint,
  disabled,
  onClick,
}: SaveWorkoutButtonProps) {
  const buttonDisabled = isBusy || !!disabled;
  const label = isBusy ? "Saving…" : "Save";
  const hasSaved = savedAt != null;
  let IconComponent = Save;
  if (isBusy) {
    IconComponent = Loader2;
  } else if (hasSaved) {
    IconComponent = Check;
  }
  const showFlash = isBusy === false && hasSaved;

  return (
    <div
      className="flex items-center gap-3"
      data-testid="workout-detail-save"
    >
      <div className="flex flex-col items-end">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={onClick}
          disabled={buttonDisabled}
          className={cn("gap-2", !buttonDisabled && "cursor-pointer")}
          data-testid="workout-detail-save-button"
          aria-live="polite"
        >
          <IconComponent
            className={cn("size-4", isBusy && "animate-spin")}
            aria-hidden
          />
          {label}
        </Button>
        {showCoachNoteHint && (
          <span className="mt-1 text-[11px] text-muted-foreground">
            Updates your coach&apos;s take
          </span>
        )}
      </div>
      {showFlash && (
        <SaveFlashBadge key={savedAt} testId="workout-detail-save-flash" />
      )}
    </div>
  );
}
