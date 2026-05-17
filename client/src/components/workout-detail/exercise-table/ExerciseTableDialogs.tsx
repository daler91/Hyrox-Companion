import { type ExerciseName } from "@shared/schema";
import { Plus, Sparkles } from "lucide-react";

import { ExerciseSelector } from "@/components/ExerciseSelector";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function AddExerciseDialog({
  open,
  onOpenChange,
  onPick,
  onAddCustom,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (name: ExerciseName) => void;
  onAddCustom: () => void;
}>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="exercise-add-dialog">
        <DialogHeader>
          <DialogTitle>Add exercise</DialogTitle>
          <DialogDescription>
            Pick an exercise from the catalog, or add a custom one.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          <ExerciseSelector selectedExercises={[]} onToggle={onPick} />
        </div>
        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">
            Can't find it? Add a custom one.
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAddCustom}
            data-testid="exercise-add-custom"
          >
            <Plus className="mr-1 size-3.5" aria-hidden />
            Add custom exercise
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EmptyExerciseState({
  onAdd,
  onParseText,
  hasUnparsedText,
}: Readonly<{ onAdd: () => void; onParseText?: () => void; hasUnparsedText: boolean }>) {
  if (hasUnparsedText) {
    return (
      <div
        className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
        data-testid="exercise-table-empty-parse-hint"
      >
        <span><strong className="font-medium text-foreground">Text prescription saved.</strong> No exercise rows yet.</span>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={onAdd}
            data-testid="exercise-table-empty-add"
          >
            <Plus className="mr-1 size-3.5" aria-hidden />
            Add exercise
          </Button>
          {onParseText ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onParseText}
              data-testid="exercise-table-empty-parse"
            >
              <Sparkles className="mr-1 size-3.5" aria-hidden />
              Parse text
            </Button>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
      <span>No exercises yet.</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onAdd}
        data-testid="exercise-table-empty-add"
      >
        <Plus className="mr-1 size-3.5" aria-hidden />
        Add exercise
      </Button>
    </div>
  );
}
