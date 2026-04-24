import type { TimelineEntry } from "@shared/schema";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface MoveWorkoutDialogProps {
  readonly entry: TimelineEntry | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: (newDate: string) => void;
  readonly isPending?: boolean;
}

/**
 * Reschedule dialog for a single timeline entry. Uses a native date
 * input so mobile gets the OS date picker for free — same pattern as
 * SchedulePlanDialog. Reseeds the input every time `entry` changes so
 * reopening the dialog on a different workout doesn't carry the
 * previous draft.
 */
export default function MoveWorkoutDialog({
  entry,
  onOpenChange,
  onConfirm,
  isPending = false,
}: Readonly<MoveWorkoutDialogProps>) {
  const [draftDate, setDraftDate] = useState<string>(entry?.date ?? "");

  useEffect(() => {
    if (entry) setDraftDate(entry.date);
  }, [entry?.id, entry?.date, entry]);

  const isOpen = !!entry;
  const isUnchanged = !!entry && draftDate === entry.date;
  const canSave = !!entry && !!draftDate && !isUnchanged && !isPending;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move workout</DialogTitle>
          <DialogDescription>
            Pick a new date for {entry?.focus || "this workout"}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="move-workout-date">New date</Label>
            <Input
              id="move-workout-date"
              type="date"
              value={draftDate}
              onChange={(e) => setDraftDate(e.target.value)}
              data-testid="input-move-workout-date"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => canSave && onConfirm(draftDate)}
            disabled={!canSave}
            data-testid="button-move-workout-confirm"
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Moving…
              </>
            ) : (
              "Move workout"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
