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
            // A <label> wrapping the radio replaces the previous
            // <button><RadioGroupItem/></button> (a <button> nested inside the
            // Radix radio's own <button>), which was invalid HTML and gave
            // undefined keyboard/AT behavior. Selection now flows through the
            // RadioGroup (onValueChange), and focus-within rings the card while
            // the inner radio is focused. (WCAG 4.1.2 / 1.3.1)
            <label
              key={goal.id}
              htmlFor={goal.id}
              className={`w-full text-left flex items-center space-x-3 p-3 rounded-md border cursor-pointer transition-colors focus-within:outline-none focus-within:ring-1 focus-within:ring-ring ${
                selectedGoal === goal.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/50"
              }`}
            >
              <RadioGroupItem value={goal.id} id={goal.id} />
              <Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              <div className="flex-1">
                <span className="font-medium">{goal.label}</span>
                <p className="text-xs text-muted-foreground">{goal.description}</p>
              </div>
              {selectedGoal === goal.id && (
                <Check className="h-4 w-4 text-primary" aria-hidden="true" />
              )}
            </label>
          );
        })}
      </RadioGroup>
      <div className="space-y-2">
        <Label htmlFor="onboarding-training-style">Training style</Label>
        <Select value={trainingStyleId} onValueChange={props.onTrainingStyleChange}>
          <SelectTrigger id="onboarding-training-style">
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
          <p className="text-sm font-medium">MAF onboarding</p>
          <Input
            id="onboarding-maf-age"
            placeholder="Age"
            aria-label="Age"
            value={props.mafAge}
            onChange={(e) => props.onMafAgeChange(e.target.value)}
          />
          <div className="flex items-center justify-between">
            <Label htmlFor="onboarding-maf-injury">Injury/illness/medication?</Label>
            <Switch
              id="onboarding-maf-injury"
              checked={props.mafInjuryIllnessMedication}
              onCheckedChange={props.onMafInjuryIllnessMedicationChange}
            />
          </div>
          <Select value={props.mafConsistency} onValueChange={props.onMafConsistencyChange}>
            <SelectTrigger aria-label="Training consistency">
              <SelectValue placeholder="Training consistency" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="moderate">Moderate</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
          <Select value={props.mafTrend} onValueChange={props.onMafTrendChange}>
            <SelectTrigger aria-label="Recent trend">
              <SelectValue placeholder="Recent trend" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="improving">Improving</SelectItem>
              <SelectItem value="flat">Flat</SelectItem>
              <SelectItem value="declining">Declining</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center justify-between">
            <Label htmlFor="onboarding-maf-hr">HR data available?</Label>
            <Switch
              id="onboarding-maf-hr"
              checked={props.mafHrDataAvailable}
              onCheckedChange={props.onMafHrDataAvailableChange}
            />
          </div>
        </div>
      )}
    </div>
  );
}
