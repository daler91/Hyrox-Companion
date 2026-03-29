import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Sparkles, ChevronRight, ChevronLeft } from "lucide-react";
import { useGeneratePlan } from "@/hooks/usePlanGeneration";
import type { GeneratePlanInput } from "@shared/schema";

const MAX_WEEKS = 24;
const MIN_WEEKS = 1;
const DEFAULT_WEEKS = 8;
const MAX_DAYS_PER_WEEK = 7;
const MIN_DAYS_PER_WEEK = 2;
const DEFAULT_DAYS_PER_WEEK = 5;

interface GeneratePlanDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

const FOCUS_OPTIONS = [
  { value: "running", label: "Running" },
  { value: "sled_push", label: "Sled Push" },
  { value: "sled_pull", label: "Sled Pull" },
  { value: "skierg", label: "SkiErg" },
  { value: "rowing", label: "Rowing" },
  { value: "wall_balls", label: "Wall Balls" },
  { value: "farmers_carry", label: "Farmers Carry" },
  { value: "burpee_broad_jump", label: "Burpee Broad Jumps" },
  { value: "strength", label: "Strength" },
  { value: "conditioning", label: "Conditioning" },
];

export function GeneratePlanDialog({ open, onOpenChange }: GeneratePlanDialogProps) {
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState("");
  const [totalWeeks, setTotalWeeks] = useState(DEFAULT_WEEKS);
  const [daysPerWeek, setDaysPerWeek] = useState(DEFAULT_DAYS_PER_WEEK);
  const [experienceLevel, setExperienceLevel] = useState<"beginner" | "intermediate" | "advanced">("intermediate");
  const [raceDate, setRaceDate] = useState("");
  const [focusAreas, setFocusAreas] = useState<string[]>([]);
  const [injuries, setInjuries] = useState("");

  const generatePlan = useGeneratePlan();

  const handleGenerate = () => {
    const input: GeneratePlanInput = {
      goal,
      totalWeeks,
      daysPerWeek,
      experienceLevel,
      ...(raceDate ? { raceDate } : {}),
      ...(focusAreas.length > 0 ? { focusAreas } : {}),
      ...(injuries ? { injuries } : {}),
    };

    generatePlan.mutate(input, {
      onSuccess: () => {
        onOpenChange(false);
        resetForm();
      },
    });
  };

  const resetForm = () => {
    setStep(0);
    setGoal("");
    setTotalWeeks(DEFAULT_WEEKS);
    setDaysPerWeek(DEFAULT_DAYS_PER_WEEK);
    setExperienceLevel("intermediate");
    setRaceDate("");
    setFocusAreas([]);
    setInjuries("");
  };

  const toggleFocus = (value: string) => {
    setFocusAreas((prev) =>
      prev.includes(value) ? prev.filter((f) => f !== value) : [...prev, value],
    );
  };

  const canProceedStep0 = goal.trim().length > 0;
  const canProceedStep1 = true; // All fields have defaults
  const canGenerate = canProceedStep0 && canProceedStep1;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) resetForm(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Generate AI Training Plan
          </DialogTitle>
          <DialogDescription>
            {step === 0 && "What's your training goal?"}
            {step === 1 && "Set your plan duration and experience level."}
            {step === 2 && "Optional: focus areas and additional details."}
          </DialogDescription>
        </DialogHeader>

        {step === 0 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="goal">Goal</Label>
              <Textarea
                id="goal"
                placeholder="e.g., Complete Hyrox Open in under 90 minutes, or Train for my first half marathon"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                maxLength={500}
                rows={3}
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setStep(1)} disabled={!canProceedStep0}>
                Next <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="weeks">Weeks</Label>
                <Input
                  id="weeks"
                  type="number"
                  min={MIN_WEEKS}
                  max={MAX_WEEKS}
                  value={totalWeeks}
                  onChange={(e) => setTotalWeeks(Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, Number.parseInt(e.target.value) || DEFAULT_WEEKS)))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="days">Days/Week</Label>
                <Input
                  id="days"
                  type="number"
                  min={MIN_DAYS_PER_WEEK}
                  max={MAX_DAYS_PER_WEEK}
                  value={daysPerWeek}
                  onChange={(e) => setDaysPerWeek(Math.min(MAX_DAYS_PER_WEEK, Math.max(MIN_DAYS_PER_WEEK, Number.parseInt(e.target.value) || DEFAULT_DAYS_PER_WEEK)))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Experience Level</Label>
              <Select value={experienceLevel} onValueChange={(v) => setExperienceLevel(v as typeof experienceLevel)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="beginner">Beginner</SelectItem>
                  <SelectItem value="intermediate">Intermediate</SelectItem>
                  <SelectItem value="advanced">Advanced</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="raceDate">Race Date (optional)</Label>
              <Input
                id="raceDate"
                type="date"
                value={raceDate}
                onChange={(e) => setRaceDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                If set, the plan will auto-schedule to peak for this date.
              </p>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(0)}>
                <ChevronLeft className="mr-1 h-4 w-4" /> Back
              </Button>
              <Button onClick={() => setStep(2)}>
                Next <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Focus Areas (optional)</Label>
              <div className="flex flex-wrap gap-2">
                {FOCUS_OPTIONS.map((opt) => (
                  <Button
                    key={opt.value}
                    variant={focusAreas.includes(opt.value) ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleFocus(opt.value)}
                    type="button"
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="injuries">Injuries or Limitations (optional)</Label>
              <Textarea
                id="injuries"
                placeholder="e.g., Recovering from knee injury, avoid heavy squats"
                value={injuries}
                onChange={(e) => setInjuries(e.target.value)}
                maxLength={500}
                rows={2}
              />
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ChevronLeft className="mr-1 h-4 w-4" /> Back
              </Button>
              <Button
                onClick={handleGenerate}
                disabled={!canGenerate || generatePlan.isPending}
              >
                {generatePlan.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Generate Plan
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
