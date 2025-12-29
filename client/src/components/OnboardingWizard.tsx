import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format, addDays } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Calendar } from "@/components/ui/calendar";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Target,
  Dumbbell,
  Trophy,
  Clock,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  FileText,
  Check,
  CalendarDays,
} from "lucide-react";

interface OnboardingWizardProps {
  open: boolean;
  onComplete: (choice: "sample" | "import" | "skip") => void;
}

type Step = "welcome" | "units" | "goal" | "plan" | "schedule";

const goals = [
  { id: "first", label: "Complete my first Hyrox", icon: Target, description: "New to Hyrox and building foundation" },
  { id: "improve", label: "Improve my finish time", icon: Clock, description: "Already competed, want to get faster" },
  { id: "podium", label: "Aim for the podium", icon: Trophy, description: "Competitive athlete targeting top placement" },
  { id: "fitness", label: "General fitness", icon: Dumbbell, description: "Using Hyrox training for overall health" },
];

export function OnboardingWizard({ open, onComplete }: OnboardingWizardProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("welcome");
  const [weightUnit, setWeightUnit] = useState<"kg" | "lbs">("kg");
  const [distanceUnit, setDistanceUnit] = useState<"km" | "miles">("km");
  const [selectedGoal, setSelectedGoal] = useState<string>("first");
  const [createdPlanId, setCreatedPlanId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<Date>(addDays(new Date(), 1));

  const updatePreferencesMutation = useMutation({
    mutationFn: async (prefs: { weightUnit: string; distanceUnit: string }) => {
      const response = await apiRequest("PATCH", "/api/preferences", prefs);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/preferences"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
  });

  const samplePlanMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/plans/sample", {});
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/plans"] });
      setCreatedPlanId(data.id);
      setStep("schedule");
    },
    onError: () => {
      toast({ title: "Failed to create plan", variant: "destructive" });
    },
  });

  const schedulePlanMutation = useMutation({
    mutationFn: async ({ planId, startDate }: { planId: string; startDate: string }) => {
      const response = await apiRequest("POST", `/api/plans/${planId}/schedule`, { startDate });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timeline"] });
      toast({ title: "Your training plan is ready!", description: "Workouts have been scheduled on your timeline." });
      markOnboardingComplete();
      onComplete("sample");
    },
    onError: () => {
      toast({ title: "Failed to schedule plan", variant: "destructive" });
    },
  });

  const markOnboardingComplete = () => {
    localStorage.setItem("hyrox-onboarding-complete", "true");
  };

  const handleNext = async () => {
    if (step === "welcome") {
      setStep("units");
    } else if (step === "units") {
      try {
        await updatePreferencesMutation.mutateAsync({ weightUnit, distanceUnit });
      } catch (error) {
        console.log("Could not save preferences, continuing anyway");
      }
      setStep("goal");
    } else if (step === "goal") {
      setStep("plan");
    }
  };

  const handleBack = () => {
    if (step === "units") setStep("welcome");
    else if (step === "goal") setStep("units");
    else if (step === "plan") setStep("goal");
    else if (step === "schedule") setStep("plan");
  };

  const handleUseSamplePlan = () => {
    samplePlanMutation.mutate();
  };

  const handleSchedulePlan = () => {
    if (createdPlanId) {
      schedulePlanMutation.mutate({
        planId: createdPlanId,
        startDate: format(startDate, "yyyy-MM-dd"),
      });
    }
  };

  const handleImportPlan = () => {
    markOnboardingComplete();
    onComplete("import");
  };

  const handleSkip = () => {
    markOnboardingComplete();
    onComplete("skip");
  };

  const displaySteps: Step[] = ["welcome", "units", "goal", "plan", "schedule"];
  const progressSteps = step === "schedule" ? 5 : 4;
  const currentStepIndex = displaySteps.indexOf(step);

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-lg" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="text-xl">
            {step === "welcome" && "Welcome to HyroxTracker"}
            {step === "units" && "Set Your Preferences"}
            {step === "goal" && "What's Your Goal?"}
            {step === "plan" && "Choose Your Path"}
            {step === "schedule" && "When Do You Start?"}
          </DialogTitle>
          <DialogDescription>
            {step === "welcome" && "Let's get you set up in just a few steps."}
            {step === "units" && "Choose your preferred measurement units."}
            {step === "goal" && "This helps us tailor your experience."}
            {step === "plan" && "How would you like to start training?"}
            {step === "schedule" && "Pick the first day of your 8-week program."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 my-2">
          {Array.from({ length: progressSteps }).map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= currentStepIndex ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>

        <div className="py-4">
          {step === "welcome" && (
            <div className="text-center space-y-4">
              <div className="flex justify-center gap-3">
                <div className="p-3 rounded-full bg-primary/10">
                  <Target className="h-6 w-6 text-primary" />
                </div>
                <div className="p-3 rounded-full bg-primary/10">
                  <Dumbbell className="h-6 w-6 text-primary" />
                </div>
                <div className="p-3 rounded-full bg-primary/10">
                  <Trophy className="h-6 w-6 text-primary" />
                </div>
              </div>
              <p className="text-muted-foreground">
                HyroxTracker helps you train smarter for Hyrox with structured plans,
                workout logging, and AI-powered coaching.
              </p>
            </div>
          )}

          {step === "units" && (
            <div className="space-y-6">
              <div className="space-y-3">
                <Label className="text-base">Weight</Label>
                <RadioGroup
                  value={weightUnit}
                  onValueChange={(v) => setWeightUnit(v as "kg" | "lbs")}
                  className="flex gap-4"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="kg" id="kg" />
                    <Label htmlFor="kg" className="cursor-pointer">Kilograms (kg)</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="lbs" id="lbs" />
                    <Label htmlFor="lbs" className="cursor-pointer">Pounds (lbs)</Label>
                  </div>
                </RadioGroup>
              </div>

              <div className="space-y-3">
                <Label className="text-base">Distance</Label>
                <RadioGroup
                  value={distanceUnit}
                  onValueChange={(v) => setDistanceUnit(v as "km" | "miles")}
                  className="flex gap-4"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="km" id="km" />
                    <Label htmlFor="km" className="cursor-pointer">Kilometers (km)</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="miles" id="miles" />
                    <Label htmlFor="miles" className="cursor-pointer">Miles</Label>
                  </div>
                </RadioGroup>
              </div>
            </div>
          )}

          {step === "goal" && (
            <RadioGroup
              value={selectedGoal}
              onValueChange={setSelectedGoal}
              className="space-y-3"
            >
              {goals.map((goal) => (
                <div
                  key={goal.id}
                  className={`flex items-center space-x-3 p-3 rounded-md border cursor-pointer transition-colors ${
                    selectedGoal === goal.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50"
                  }`}
                  onClick={() => setSelectedGoal(goal.id)}
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
                </div>
              ))}
            </RadioGroup>
          )}

          {step === "plan" && (
            <div className="space-y-3">
              <Button
                className="w-full justify-start h-auto py-4"
                onClick={handleUseSamplePlan}
                disabled={samplePlanMutation.isPending}
                data-testid="button-onboarding-sample-plan"
              >
                <div className="flex items-center gap-3 w-full">
                  {samplePlanMutation.isPending ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Sparkles className="h-5 w-5" />
                  )}
                  <div className="text-left flex-1">
                    <div className="font-medium">Use 8-Week Hyrox Plan</div>
                    <div className="text-xs opacity-80 font-normal">
                      Recommended - structured program for all levels
                    </div>
                  </div>
                </div>
              </Button>

              <Button
                variant="outline"
                className="w-full justify-start h-auto py-4"
                onClick={handleImportPlan}
                data-testid="button-onboarding-import"
              >
                <div className="flex items-center gap-3 w-full">
                  <FileText className="h-5 w-5" />
                  <div className="text-left flex-1">
                    <div className="font-medium">Import Your Own Plan</div>
                    <div className="text-xs text-muted-foreground font-normal">
                      Upload a CSV training plan
                    </div>
                  </div>
                </div>
              </Button>

              <Button
                variant="ghost"
                className="w-full"
                onClick={handleSkip}
                data-testid="button-onboarding-skip"
              >
                Skip for now - I'll log workouts manually
              </Button>
            </div>
          )}

          {step === "schedule" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <CalendarDays className="h-4 w-4" />
                <span>Your plan will start on {format(startDate, "EEEE, MMMM d, yyyy")}</span>
              </div>
              <div className="flex justify-center">
                <Calendar
                  mode="single"
                  selected={startDate}
                  onSelect={(date) => date && setStartDate(date)}
                  disabled={(date) => date < new Date()}
                  className="rounded-md border"
                  data-testid="calendar-start-date"
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-between pt-2">
          {step !== "welcome" && step !== "plan" ? (
            <Button variant="ghost" onClick={handleBack} disabled={schedulePlanMutation.isPending}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          ) : (
            <div />
          )}

          {step === "schedule" ? (
            <Button
              onClick={handleSchedulePlan}
              disabled={schedulePlanMutation.isPending}
              data-testid="button-onboarding-start-plan"
            >
              {schedulePlanMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : null}
              Start Training
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : step !== "plan" ? (
            <Button
              onClick={handleNext}
              disabled={updatePreferencesMutation.isPending}
            >
              {updatePreferencesMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : null}
              {step === "welcome" ? "Get Started" : "Continue"}
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
