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
  readonly mafCategory: string;
  readonly onMafCategoryChange: (value: string) => void;
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
          {/* Maffetone's own category question, asked as he states it (audit
              M6). The previous boolean + consistency/trend selects collapsed
              his -10 and -5 categories — allergies cost the same 10 bpm as
              post-surgery recovery — and granted +5 with no training-duration
              question at all. */}
          <Select value={props.mafCategory} onValueChange={props.onMafCategoryChange}>
            <SelectTrigger aria-label="Maffetone health and training category">
              <SelectValue placeholder="Which best describes you?" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recovering_or_medicated">
                Recovering from major illness or surgery, or on regular medication
              </SelectItem>
              <SelectItem value="training_interrupted">
                Injured, regressing, frequent colds, allergies/asthma, or new/inconsistent training
              </SelectItem>
              <SelectItem value="consistent_up_to_2y">
                Training consistently (up to 2 years) without those problems
              </SelectItem>
              <SelectItem value="consistent_2y_plus_improving">
                Training 2+ years without those problems, and improving
              </SelectItem>
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
