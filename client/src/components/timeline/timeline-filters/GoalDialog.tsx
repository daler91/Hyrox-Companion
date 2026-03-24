import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Target } from "lucide-react";

interface GoalDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly goalText: string;
  readonly setGoalText: (text: string) => void;
  readonly onSubmit: () => void;
  readonly isUpdatingGoal?: boolean;
}

export function GoalDialog({
  open,
  onOpenChange,
  goalText,
  setGoalText,
  onSubmit,
  isUpdatingGoal,
}: Readonly<GoalDialogProps>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-4 w-4" />
            Plan Goal
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="plan-goal-input">What are you training towards?</Label>
          <Textarea
            id="plan-goal-input"
            value={goalText}
            onChange={(e) => setGoalText(e.target.value.slice(0, 500))}
            placeholder="e.g. Complete Hyrox in under 90 minutes, finish my first marathon sub-4h…"
            className="resize-none"
            rows={3}
            data-testid="input-plan-goal"
          />
          <p className="text-xs text-muted-foreground text-right">{goalText.length}/500</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={isUpdatingGoal} data-testid="button-goal-submit">
            {isUpdatingGoal ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Goal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
