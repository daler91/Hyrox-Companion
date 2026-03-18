import React from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Save } from "lucide-react";

interface WorkoutSaveButtonProps {
  handleSave: () => void;
  isPending: boolean;
}

export const WorkoutSaveButton = ({ handleSave, isPending }: Readonly<WorkoutSaveButtonProps>) => {
  return (
    <div className="pt-2 pb-6 md:pb-0">
      <Button
        onClick={handleSave}
        disabled={isPending}
        className="w-full shadow-lg"
        size="lg"
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
  );
};
