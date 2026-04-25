import { Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";

interface WorkoutSaveButtonProps {
  handleSave: () => void;
  isPending: boolean;
  onCancel?: () => void;
  hasWorkoutDetails?: boolean;
}

export const WorkoutSaveButton = ({
  handleSave,
  isPending,
  onCancel,
  hasWorkoutDetails = false,
}: Readonly<WorkoutSaveButtonProps>) => {
  return (
    <div
      className={
        // Mobile: fixed bottom bar with backdrop blur so it floats above content.
        // Desktop (md+): revert to inline block in the left column layout.
        "fixed inset-x-0 bottom-0 z-40 flex flex-col gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur " +
        "md:static md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none md:pt-2 md:pb-0"
      }
      data-testid="workout-save-bar"
    >
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{hasWorkoutDetails ? "Ready to save" : "Add workout details to save"}</span>
        {isPending ? <span role="status">Saving...</span> : null}
      </div>
      <div className="flex gap-2 md:flex-col">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isPending}
            size="lg"
            className="flex-1 md:w-full"
            data-testid="button-cancel-workout"
          >
            Cancel
          </Button>
        )}
        <Button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          size="lg"
          className="flex-1 md:w-full shadow-lg"
          data-testid="button-save-workout"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          {isPending ? "Saving..." : "Save Workout"}
        </Button>
      </div>
    </div>
  );
};
