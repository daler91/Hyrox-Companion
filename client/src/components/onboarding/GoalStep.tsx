import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Target, Clock, Trophy, Dumbbell, Check } from "lucide-react";

const goals = [
  { id: "first", label: "Complete my first Hyrox", icon: Target, description: "New to Hyrox and building foundation" },
  { id: "improve", label: "Improve my finish time", icon: Clock, description: "Already competed, want to get faster" },
  { id: "podium", label: "Aim for the podium", icon: Trophy, description: "Competitive athlete targeting top placement" },
  { id: "fitness", label: "General fitness", icon: Dumbbell, description: "Using Hyrox training for overall health" },
];

interface GoalStepProps {
  readonly selectedGoal: string;
  readonly onGoalChange: (goal: string) => void;
}

export function GoalStep({ selectedGoal, onGoalChange }: GoalStepProps) {
  return (
    <RadioGroup
      value={selectedGoal}
      onValueChange={onGoalChange}
      className="space-y-3"
    >
      {goals.map((goal) => (
        <button
          type="button"
          key={goal.id}
          className={`w-full text-left flex items-center space-x-3 p-3 rounded-md border cursor-pointer transition-colors ${
            selectedGoal === goal.id
              ? "border-primary bg-primary/5"
              : "border-border hover:bg-muted/50"
          }`}
          onClick={() => onGoalChange(goal.id)}
        >
          <RadioGroupItem value={goal.id} id={goal.id} />
          <goal.icon className="h-5 w-5 text-muted-foreground" />
          <div className="flex-1">
            <Label htmlFor={goal.id} className="cursor-pointer font-medium">
              {goal.label}
            </Label>
            <p className="text-xs text-muted-foreground">{goal.description}</p>
          </div>
          {selectedGoal === goal.id && (
            <Check className="h-4 w-4 text-primary" />
          )}
        </button>
      ))}
    </RadioGroup>
  );
}
