import {
  Activity,
  Check,
  Dumbbell,
  type LucideIcon,
  Target,
  TrendingDown,
  Zap,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import { ONBOARDING_GOALS, type OnboardingGoalId } from "./onboardingGoals";

const goalIcons: Record<OnboardingGoalId, LucideIcon> = {
  strength: Dumbbell,
  endurance: Activity,
  functional: Zap,
  weight_loss: TrendingDown,
  fitness: Target,
};

interface GoalStepProps {
  readonly selectedGoal: string;
  readonly onGoalChange: (goal: string) => void;
  readonly trainingStyleId: string;
  readonly onTrainingStyleChange: (style: string) => void;
  readonly mafAge: string;
  readonly onMafAgeChange: (age: string) => void;
  readonly mafInjuryIllnessMedication: boolean;
  readonly onMafInjuryIllnessMedicationChange: (value: boolean) => void;
  readonly mafConsistency: string;
  readonly onMafConsistencyChange: (value: string) => void;
  readonly mafTrend: string;
  readonly onMafTrendChange: (value: string) => void;
  readonly mafHrDataAvailable: boolean;
  readonly onMafHrDataAvailableChange: (value: boolean) => void;
}

export function GoalStep(props: Readonly<GoalStepProps>) {
  const { selectedGoal, onGoalChange, trainingStyleId } = props;
  return (
    <div className="space-y-4">
      <RadioGroup value={selectedGoal} onValueChange={onGoalChange} className="space-y-3">
        {ONBOARDING_GOALS.map((goal) => {
          const Icon = goalIcons[goal.id];
          return (
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
              <Icon className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1">
                <Label htmlFor={goal.id} className="cursor-pointer font-medium">
                  {goal.label}
                </Label>
                <p className="text-xs text-muted-foreground">{goal.description}</p>
              </div>
              {selectedGoal === goal.id && <Check className="h-4 w-4 text-primary" />}
            </button>
          );
        })}
      </RadioGroup>
      <div className="space-y-2">
        <Label>Training style</Label>
        <Select value={trainingStyleId} onValueChange={props.onTrainingStyleChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="balanced_default">Balanced</SelectItem>
            <SelectItem value="maf_method">MAF Method</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {trainingStyleId === "maf_method" && (
        <div className="space-y-3 rounded-md border p-3">
          <Label>MAF onboarding</Label>
          <Input
            placeholder="Age"
            value={props.mafAge}
            onChange={(e) => props.onMafAgeChange(e.target.value)}
          />
          <div className="flex items-center justify-between">
            <Label>Injury/illness/medication?</Label>
            <Switch
              checked={props.mafInjuryIllnessMedication}
              onCheckedChange={props.onMafInjuryIllnessMedicationChange}
            />
          </div>
          <Select value={props.mafConsistency} onValueChange={props.onMafConsistencyChange}>
            <SelectTrigger>
              <SelectValue placeholder="Training consistency" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="moderate">Moderate</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
          <Select value={props.mafTrend} onValueChange={props.onMafTrendChange}>
            <SelectTrigger>
              <SelectValue placeholder="Recent trend" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="improving">Improving</SelectItem>
              <SelectItem value="flat">Flat</SelectItem>
              <SelectItem value="declining">Declining</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center justify-between">
            <Label>HR data available?</Label>
            <Switch
              checked={props.mafHrDataAvailable}
              onCheckedChange={props.onMafHrDataAvailableChange}
            />
          </div>
        </div>
      )}
    </div>
  );
}
