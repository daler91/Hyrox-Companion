import { Activity, Check, Dumbbell, Target, TrendingDown,Zap } from "lucide-react";

import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

const goals = [
  { id: "strength", label: "Build strength", icon: Dumbbell, description: "Get stronger with progressive resistance training" },
  { id: "endurance", label: "Improve endurance", icon: Activity, description: "Train for races or improve cardio fitness" },
  { id: "functional", label: "Functional fitness", icon: Zap, description: "Hyrox, CrossFit, or general functional training" },
  { id: "weight_loss", label: "Lose weight", icon: TrendingDown, description: "Combine training with body composition goals" },
  { id: "fitness", label: "General fitness", icon: Target, description: "Overall health and well-being" },
];

interface GoalStepProps {
  readonly selectedGoal: string;
  readonly onGoalChange: (goal: string) => void;
}

export function GoalStep({ selectedGoal, onGoalChange }: Readonly<GoalStepProps>) {
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
          className={`w-full text-left flex items-center space-x-3 p-3 rounded-md border cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
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
