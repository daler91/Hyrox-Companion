import { Loader2 } from "lucide-react";

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
import { weekOneStartNote } from "@/lib/planStart";

interface SchedulePlanDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly startDate: string;
  readonly onStartDateChange: (date: string) => void;
  readonly onSchedule: () => void;
  readonly isPending: boolean;
}

export default function SchedulePlanDialog({
  open,
  onOpenChange,
  startDate,
  onStartDateChange,
  onSchedule,
  isPending,
}: Readonly<SchedulePlanDialogProps>) {
  // Sessions are never placed before the start date, so a midweek start leaves
  // week 1's earlier sessions off the calendar; say so (onboarding audit C3).
  const note = startDate ? weekOneStartNote(startDate) : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule Your Training Plan</DialogTitle>
          <DialogDescription className="sr-only">
            Schedule your training plan start date
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Choose when your training plan should start. No session is scheduled before this date.
          </p>
          <div>
            <Label htmlFor="start-date">Start date</Label>
            <Input
              id="start-date"
              type="date"
              value={startDate}
              onChange={(e) => onStartDateChange(e.target.value)}
              aria-describedby={note ? "start-date-note" : undefined}
              data-testid="input-start-date"
            />
            {note && (
              <p
                id="start-date-note"
                className="mt-2 text-xs text-muted-foreground"
                data-testid="text-week-one-note"
              >
                {note}
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onSchedule}
            disabled={isPending}
            data-testid="button-schedule-plan"
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                Scheduling...
              </>
            ) : (
              "Schedule Plan"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
