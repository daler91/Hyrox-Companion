import type { GeneratePlanInput } from "@shared/schema";
import { ChevronLeft,ChevronRight, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { CharacterCount } from "@/components/ui/character-count";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useGeneratePlan } from "@/hooks/usePlanGeneration";
import { toISODateString } from "@/lib/dateUtils";

const MAX_WEEKS = 24;
const MIN_WEEKS = 1;
const DEFAULT_WEEKS = 8;
const MAX_DAYS_PER_WEEK = 7;
const MIN_DAYS_PER_WEEK = 2;
const DEFAULT_DAYS_PER_WEEK = 5;

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

const DEFAULT_REST_DAYS: Record<number, string[]> = {
  7: [],
  6: ["Sunday"],
  5: ["Saturday", "Sunday"],
  4: ["Wednesday", "Saturday", "Sunday"],
  3: ["Tuesday", "Thursday", "Saturday", "Sunday"],
  2: ["Monday", "Wednesday", "Friday", "Saturday", "Sunday"],
};

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

function calculateSuggestedStartDate(race: string, weeks: number): string {
  const raceD = new Date(race);
  const start = new Date(raceD);
  start.setDate(start.getDate() - weeks * 7);
  const dayOfWeek = start.getDay();
  let mondayOffset: number;
  if (dayOfWeek === 0) mondayOffset = 1;
  else if (dayOfWeek === 1) mondayOffset = 0;
  else mondayOffset = 8 - dayOfWeek;
  start.setDate(start.getDate() + mondayOffset);
  // Local-TZ string: matches plan-day scheduledDate semantics on the server
  // (which is also user-local). UTC would shift by a day for evening users.
  return toISODateString(start);
}

function useGeneratePlanForm() {
  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState("");
  const [totalWeeks, setTotalWeeks] = useState(DEFAULT_WEEKS);
  const [daysPerWeek, setDaysPerWeek] = useState(DEFAULT_DAYS_PER_WEEK);
  const [experienceLevel, setExperienceLevel] = useState<"beginner" | "intermediate" | "advanced">("intermediate");
  const [raceDate, setRaceDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [restDays, setRestDays] = useState<string[]>(DEFAULT_REST_DAYS[DEFAULT_DAYS_PER_WEEK]);
  const [focusAreas, setFocusAreas] = useState<string[]>([]);
  const [injuries, setInjuries] = useState("");

  const resetForm = () => {
    setStep(0);
    setGoal("");
    setTotalWeeks(DEFAULT_WEEKS);
    setDaysPerWeek(DEFAULT_DAYS_PER_WEEK);
    setExperienceLevel("intermediate");
    setRaceDate("");
    setStartDate("");
    setRestDays(DEFAULT_REST_DAYS[DEFAULT_DAYS_PER_WEEK]);
    setFocusAreas([]);
    setInjuries("");
  };

  const toggleFocus = (value: string) => {
    setFocusAreas((prev) =>
      prev.includes(value) ? prev.filter((f) => f !== value) : [...prev, value],
    );
  };

  const toggleRestDay = (day: string) => {
    setRestDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  };

  const handleDaysPerWeekChange = (value: number) => {
    const clamped = Math.min(MAX_DAYS_PER_WEEK, Math.max(MIN_DAYS_PER_WEEK, value));
    setDaysPerWeek(clamped);
    setRestDays(DEFAULT_REST_DAYS[clamped] ?? []);
  };

  const handleRaceDateChange = (value: string) => {
    setRaceDate(value);
    if (value && !startDate) {
      setStartDate(calculateSuggestedStartDate(value, totalWeeks));
    }
  };

  const requiredRestDays = 7 - daysPerWeek;
  const canProceedStep0 = goal.trim().length > 0;
  const canProceedStep1 = daysPerWeek === 7 || restDays.length === requiredRestDays;
  const canGenerate = canProceedStep0 && canProceedStep1;

  return {
    step, setStep,
    goal, setGoal,
    totalWeeks, setTotalWeeks,
    daysPerWeek,
    experienceLevel, setExperienceLevel,
    raceDate,
    startDate, setStartDate,
    restDays,
    focusAreas,
    injuries, setInjuries,
    resetForm,
    toggleFocus,
    toggleRestDay,
    handleDaysPerWeekChange,
    handleRaceDateChange,
    requiredRestDays,
    canProceedStep0,
    canProceedStep1,
    canGenerate,
  };
}

export function GeneratePlanDialog({ open, onOpenChange }: GeneratePlanDialogProps) {
  const form = useGeneratePlanForm();
  const generatePlan = useGeneratePlan();

  const handleGenerate = () => {
    const input: GeneratePlanInput = {
      goal: form.goal,
      totalWeeks: form.totalWeeks,
      daysPerWeek: form.daysPerWeek,
      experienceLevel: form.experienceLevel,
      ...(form.raceDate ? { raceDate: form.raceDate } : {}),
      ...(form.startDate ? { startDate: form.startDate } : {}),
      ...(form.daysPerWeek < 7 && form.restDays.length > 0 ? { restDays: form.restDays as GeneratePlanInput["restDays"] } : {}),
      ...(form.focusAreas.length > 0 ? { focusAreas: form.focusAreas } : {}),
      ...(form.injuries ? { injuries: form.injuries } : {}),
    };

    generatePlan.mutate(input, {
      onSuccess: () => {
        onOpenChange(false);
        form.resetForm();
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) form.resetForm(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Generate AI Training Plan
          </DialogTitle>
          <DialogDescription>
            {form.step === 0 && "What's your training goal?"}
            {form.step === 1 && "Set your plan duration and experience level."}
            {form.step === 2 && "Optional: focus areas and additional details."}
          </DialogDescription>
        </DialogHeader>

        {form.step === 0 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="goal">Goal</Label>
              <Textarea
                id="goal"
                placeholder="e.g. complete hyrox open in under 90 minutes, or train for my first half marathon"
                value={form.goal}
                onChange={(e) => form.setGoal(e.target.value)}
                maxLength={500}
                rows={3}
                aria-describedby="goal-count"
              />
              <CharacterCount id="goal-count" value={form.goal} max={500} />
            </div>
            <div className="flex justify-end">
              <Button onClick={() => form.setStep(1)} disabled={!form.canProceedStep0}>
                Next <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {form.step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="weeks">Weeks</Label>
                <Input
                  id="weeks"
                  type="number"
                  min={MIN_WEEKS}
                  max={MAX_WEEKS}
                  value={form.totalWeeks}
                  onChange={(e) => form.setTotalWeeks(Math.min(MAX_WEEKS, Math.max(MIN_WEEKS, Number.parseInt(e.target.value) || DEFAULT_WEEKS)))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="days">Days/Week</Label>
                <Input
                  id="days"
                  type="number"
                  min={MIN_DAYS_PER_WEEK}
                  max={MAX_DAYS_PER_WEEK}
                  value={form.daysPerWeek}
                  onChange={(e) => form.handleDaysPerWeekChange(Number.parseInt(e.target.value) || DEFAULT_DAYS_PER_WEEK)}
                />
              </div>
            </div>

            {form.daysPerWeek < 7 && (
              <div className="space-y-2">
                <Label>Rest Days <span className="text-muted-foreground font-normal">(select {form.requiredRestDays})</span></Label>
                <div className="flex flex-wrap gap-1.5">
                  {DAY_NAMES.map((day) => (
                    <Button
                      key={day}
                      variant={form.restDays.includes(day) ? "default" : "outline"}
                      size="sm"
                      className="text-xs px-2 py-1 h-7"
                      onClick={() => form.toggleRestDay(day)}
                      disabled={!form.restDays.includes(day) && form.restDays.length >= form.requiredRestDays}
                      type="button"
                    >
                      {day.slice(0, 3)}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Experience Level</Label>
              <Select value={form.experienceLevel} onValueChange={(v) => form.setExperienceLevel(v as typeof form.experienceLevel)}>
                <SelectTrigger aria-label="Select experience level">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="beginner">Beginner</SelectItem>
                  <SelectItem value="intermediate">Intermediate</SelectItem>
                  <SelectItem value="advanced">Advanced</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startDate">Start Date</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => form.setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="raceDate">Race Date</Label>
                <Input
                  id="raceDate"
                  type="date"
                  value={form.raceDate}
                  onChange={(e) => form.handleRaceDateChange(e.target.value)}
                />
              </div>
              <p className="col-span-2 text-xs text-muted-foreground -mt-2">
                Both optional. Race date structures phases to peak on that day.
              </p>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => form.setStep(0)}>
                <ChevronLeft className="mr-1 h-4 w-4" /> Back
              </Button>
              <Button onClick={() => form.setStep(2)}>
                Next <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {form.step === 2 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Focus Areas (optional)</Label>
              <div className="flex flex-wrap gap-2">
                {FOCUS_OPTIONS.map((opt) => (
                  <Button
                    key={opt.value}
                    variant={form.focusAreas.includes(opt.value) ? "default" : "outline"}
                    size="sm"
                    onClick={() => form.toggleFocus(opt.value)}
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
                value={form.injuries}
                onChange={(e) => form.setInjuries(e.target.value)}
                maxLength={500}
                rows={2}
                aria-describedby="injuries-count"
              />
              <CharacterCount id="injuries-count" value={form.injuries} max={500} />
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => form.setStep(1)}>
                <ChevronLeft className="mr-1 h-4 w-4" /> Back
              </Button>
              <Button
                onClick={handleGenerate}
                disabled={!form.canGenerate || generatePlan.isPending}
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
