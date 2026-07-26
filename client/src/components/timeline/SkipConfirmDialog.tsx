import type { PlanDaySkipReason, TimelineEntry } from "@shared/schema";
import { addDays, format } from "date-fns";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { ConfirmDialog } from "./ConfirmDialog";

const SKIP_REASONS: ReadonlyArray<{ value: PlanDaySkipReason; label: string }> = [
  { value: "ill", label: "Ill" },
  { value: "injured", label: "Injured" },
  { value: "schedule", label: "Schedule" },
  { value: "low_energy", label: "Low energy" },
];

interface SkipConfirmDialogProps {
  readonly entry: TimelineEntry | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: (reason: PlanDaySkipReason | null) => void;
  readonly onMove?: (entry: TimelineEntry, newDate: string) => void;
  readonly isMoving?: boolean;
}

/**
 * Skipping a session, with somewhere to say why and a way out.
 *
 * Two deliberate choices. The reason is optional — making the app's most
 * frequent negative interaction gate on a form field only teaches people to
 * dismiss the dialog. And "move to" sits alongside the skip rather than behind
 * it, because most skips are a scheduling problem: an athlete who could do the
 * session on Thursday shouldn't have to record a failure to get there.
 */
export default function SkipConfirmDialog(props: Readonly<SkipConfirmDialogProps>) {
  // Keyed on the session so the draft reason resets by remounting rather than by
  // an effect — the same idiom LogFoodDialog uses to reseed its form. Without
  // this, one session's reason carries into the next skip.
  return <SkipConfirmDialogBody key={props.entry?.planDayId ?? "none"} {...props} />;
}

function SkipConfirmDialogBody({
  entry,
  onOpenChange,
  onConfirm,
  onMove,
  isMoving,
}: Readonly<SkipConfirmDialogProps>) {
  const [reason, setReason] = useState<PlanDaySkipReason | null>(null);
  const [pickedDate, setPickedDate] = useState("");

  const canMove = Boolean(onMove && entry?.planDayId);

  const moveTo = (newDate: string) => {
    if (!entry || !newDate) return;
    onMove?.(entry, newDate);
    onOpenChange(false);
  };

  const quickMoves = [
    { label: "Tomorrow", date: format(addDays(new Date(), 1), "yyyy-MM-dd") },
    { label: "Next week", date: format(addDays(new Date(), 7), "yyyy-MM-dd") },
  ];

  return (
    <ConfirmDialog
      open={!!entry}
      onOpenChange={(open) => !open && onOpenChange(false)}
      title="Skip this workout?"
      description={`This will mark "${entry?.focus}" as skipped. You can still go back and complete it later if needed.`}
      confirmText="Skip Workout"
      cancelText="Cancel"
      onConfirm={() => onConfirm(reason)}
      cancelTestId="button-cancel-skip"
      confirmTestId="button-confirm-skip"
    >
      <div className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">
            Why? <span className="font-normal text-muted-foreground">(optional)</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {SKIP_REASONS.map(({ value, label }) => {
              const selected = reason === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setReason(selected ? null : value)}
                  data-testid={`skip-reason-${value}`}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm transition-colors",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-accent",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </fieldset>

        {canMove ? (
          <div className="space-y-2 border-t pt-3">
            <p className="text-sm font-medium text-foreground">Instead of skipping</p>
            <div className="flex flex-wrap items-center gap-2">
              {quickMoves.map(({ label, date }) => (
                <Button
                  key={label}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isMoving}
                  onClick={() => moveTo(date)}
                  data-testid={`skip-move-${label.toLowerCase().replace(" ", "-")}`}
                >
                  {label}
                </Button>
              ))}
              <div className="flex items-center gap-2">
                <Label htmlFor="skip-move-date" className="sr-only">
                  Move to a specific date
                </Label>
                <Input
                  id="skip-move-date"
                  type="date"
                  value={pickedDate}
                  onChange={(event) => setPickedDate(event.target.value)}
                  className="h-9 w-auto"
                  data-testid="skip-move-date"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!pickedDate || isMoving}
                  onClick={() => moveTo(pickedDate)}
                  data-testid="skip-move-confirm"
                >
                  Move
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}
