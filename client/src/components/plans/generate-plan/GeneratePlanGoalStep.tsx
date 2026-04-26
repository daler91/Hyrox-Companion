import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CharacterCount } from "@/components/ui/character-count";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface GeneratePlanGoalStepProps {
  readonly goal: string;
  readonly onGoalChange: (value: string) => void;
  readonly onNext: () => void;
  readonly canProceed: boolean;
}

export function GeneratePlanGoalStep({
  goal,
  onGoalChange,
  onNext,
  canProceed,
}: GeneratePlanGoalStepProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="goal">Goal</Label>
        <Textarea
          id="goal"
          placeholder="e.g. complete hyrox open in under 90 minutes, or train for my first half marathon"
          value={goal}
          onChange={(event) => onGoalChange(event.target.value)}
          maxLength={500}
          rows={3}
          aria-describedby="goal-count"
        />
        <CharacterCount id="goal-count" value={goal} max={500} />
      </div>
      <div className="flex justify-end">
        <Button onClick={onNext} disabled={!canProceed}>
          Next <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
