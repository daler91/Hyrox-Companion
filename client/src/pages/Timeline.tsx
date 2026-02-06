import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  FileText,
  Calendar,
  Loader2,
  ChevronDown,
  ChevronUp,
  Dumbbell,
  Target,
  Zap,
  Sparkles,
} from "lucide-react";
import { Link } from "wouter";
import { CoachPanel } from "@/components/CoachPanel";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import type { TrainingPlan, TimelineEntry, PlanDay, WorkoutStatus } from "@shared/schema";
import { format, parseISO, isToday, startOfWeek, addDays } from "date-fns";
import {
  TimelineSkeleton,
  TimelineHeader,
  TimelineFilters,
  TimelineDateGroup,
  SchedulePlanDialog,
  WorkoutDetailDialog,
  SkipConfirmDialog,
  ImportPreviewDialog,
  FloatingActionButton,
  CombineWorkoutsDialog,
  type FilterStatus,
  type CsvPreviewData,
} from "@/components/timeline";

export default function Timeline() {
  const { toast } = useToast();
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [detailEntry, setDetailEntry] = useState<TimelineEntry | null>(null);
  const [schedulingPlanId, setSchedulingPlanId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string>(
    format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd")
  );
  const [skipConfirmEntry, setSkipConfirmEntry] = useState<TimelineEntry | null>(null);
  const [csvPreview, setCsvPreview] = useState<CsvPreviewData | null>(null);
  const [showAllPast, setShowAllPast] = useState(false);
  const [showAllFuture, setShowAllFuture] = useState(false);
  const [combiningEntry, setCombiningEntry] = useState<TimelineEntry | null>(null);
  const [combineSecondEntry, setCombineSecondEntry] = useState<TimelineEntry | null>(null);
  const [showCombineDialog, setShowCombineDialog] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);
  const [hasAutoOpenedCoach, setHasAutoOpenedCoach] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingTriggered, setOnboardingTriggered] = useState(false);
  
  const todayRef = useRef<HTMLDivElement>(null);
  
  const scrollToToday = () => {
    todayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const { data: plans = [], isLoading: plansLoading } = useQuery<TrainingPlan[]>({
    queryKey: ["/api/plans"],
  });

  const { data: timelineData = [], isLoading: timelineLoading } = useQuery<TimelineEntry[]>({
    queryKey: ["/api/timeline", selectedPlanId],
    queryFn: async () => {
      const url = selectedPlanId 
        ? `/api/timeline?planId=${selectedPlanId}` 
        : `/api/timeline`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch timeline");
      return res.json();
    },
  });

  useEffect(() => {
    if (!timelineLoading && todayRef.current) {
      setTimeout(() => {
        todayRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    }
  }, [timelineLoading]);

  const isNewUser = !plansLoading && !timelineLoading && plans.length === 0 && timelineData.length === 0;

  // Trigger onboarding for new users who haven't completed it
  useEffect(() => {
    if (isNewUser && !onboardingTriggered && !localStorage.getItem("hyrox-onboarding-complete")) {
      setOnboardingTriggered(true);
      setShowOnboarding(true);
    }
  }, [isNewUser, onboardingTriggered]);

  // Auto-open coach after onboarding completes (desktop only)
  useEffect(() => {
    if (!showOnboarding && onboardingTriggered && !hasAutoOpenedCoach) {
      setHasAutoOpenedCoach(true);
      setTimeout(() => {
        // Check mobile state at execution time to avoid race with hook initialization
        const isCurrentlyMobile = window.innerWidth < 768;
        if (!isCurrentlyMobile) {
          setCoachOpen(true);
        }
      }, 500);
    }
  }, [showOnboarding, onboardingTriggered, hasAutoOpenedCoach]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleOnboardingComplete = (choice: "sample" | "import" | "skip") => {
    setShowOnboarding(false);
    if (choice === "import" && fileInputRef.current) {
      setTimeout(() => {
        fileInputRef.current?.click();
      }, 100);
    } else if (choice === "sample") {
      queryClient.invalidateQueries({ queryKey: ["/api/plans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timeline"] });
    }
  };

  const importMutation = useMutation({
    mutationFn: async (data: { csvContent: string; fileName: string }) => {
      const response = await apiRequest("POST", "/api/plans/import", data);
      return response.json();
    },
    onSuccess: (plan) => {
      queryClient.invalidateQueries({ queryKey: ["/api/plans"] });
      setSchedulingPlanId(plan.id);
      toast({ title: "Plan imported! Now set a start date." });
    },
    onError: () => {
      toast({ title: "Failed to import plan", variant: "destructive" });
    },
  });

  const samplePlanMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/plans/sample", {});
      return response.json();
    },
    onSuccess: (plan) => {
      queryClient.invalidateQueries({ queryKey: ["/api/plans"] });
      setSchedulingPlanId(plan.id);
      toast({ title: "Sample plan created! Now set a start date." });
    },
    onError: () => {
      toast({ title: "Failed to create sample plan", variant: "destructive" });
    },
  });

  const renamePlanMutation = useMutation({
    mutationFn: async ({ planId, name }: { planId: string; name: string }) => {
      await apiRequest("PATCH", `/api/plans/${planId}`, { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timeline"] });
      toast({ title: "Plan renamed" });
    },
    onError: () => {
      toast({ title: "Failed to rename plan", variant: "destructive" });
    },
  });

  const schedulePlanMutation = useMutation({
    mutationFn: async ({ planId, startDate }: { planId: string; startDate: string }) => {
      // Use backend endpoint which handles week normalization (e.g., weeks 9-16 → 1-8)
      await apiRequest("POST", `/api/plans/${planId}/schedule`, { startDate });
    },
    onSuccess: () => {
      const planIdToSelect = schedulingPlanId;
      queryClient.invalidateQueries({ queryKey: ["/api/timeline", planIdToSelect] });
      queryClient.invalidateQueries({ queryKey: ["/api/plans"] });
      if (planIdToSelect) {
        setSelectedPlanId(planIdToSelect);
      }
      setSchedulingPlanId(null);
      toast({ title: "Training plan scheduled!" });
    },
    onError: () => {
      toast({ title: "Failed to schedule plan", variant: "destructive" });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ dayId, status }: { dayId: string; status: string }) => {
      const response = await apiRequest("PATCH", `/api/plans/days/${dayId}/status`, { status });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timeline"] });
      toast({ title: "Status updated" });
    },
    onError: () => {
      toast({ title: "Failed to update status", variant: "destructive" });
    },
  });

  const updateDayMutation = useMutation({
    mutationFn: async ({ dayId, updates }: { dayId: string; updates: Partial<PlanDay> }) => {
      const response = await apiRequest("PATCH", `/api/plans/${selectedPlanId}/days/${dayId}`, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timeline"] });
      setDetailEntry(null);
      toast({ title: "Entry updated" });
    },
    onError: () => {
      toast({ title: "Failed to update entry", variant: "destructive" });
    },
  });

  const logWorkoutMutation = useMutation({
    mutationFn: async (data: { planDayId: string; date: string; focus: string; mainWorkout: string; accessory?: string; notes?: string; exercises?: any[] }) => {
      const response = await apiRequest("POST", "/api/workouts", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timeline"] });
      setDetailEntry(null);
      toast({ title: "Workout logged!" });
    },
    onError: () => {
      toast({ title: "Failed to log workout", variant: "destructive" });
    },
  });

  const updateWorkoutMutation = useMutation({
    mutationFn: async ({ workoutId, updates }: { workoutId: string; updates: Record<string, any> }) => {
      const response = await apiRequest("PATCH", `/api/workouts/${workoutId}`, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workouts"] });
      setDetailEntry(null);
      toast({ title: "Workout updated" });
    },
    onError: () => {
      toast({ title: "Failed to update workout", variant: "destructive" });
    },
  });

  const deleteWorkoutMutation = useMutation({
    mutationFn: async (workoutId: string) => {
      const response = await apiRequest("DELETE", `/api/workouts/${workoutId}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workouts"] });
      setDetailEntry(null);
      toast({ title: "Workout deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete workout", variant: "destructive" });
    },
  });

  const deletePlanDayMutation = useMutation({
    mutationFn: async (dayId: string) => {
      const response = await apiRequest("DELETE", `/api/plans/days/${dayId}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/plans"] });
      setDetailEntry(null);
      toast({ title: "Workout removed from plan" });
    },
    onError: () => {
      toast({ title: "Failed to delete workout", variant: "destructive" });
    },
  });

  const parseCSVForPreview = (csvContent: string) => {
    const lines = csvContent.trim().split('\n');
    if (lines.length < 2) return [];
    
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
    const weekIdx = headers.findIndex(h => h.includes('week'));
    const dayIdx = headers.findIndex(h => h.includes('day'));
    const focusIdx = headers.findIndex(h => h.includes('focus') || h.includes('type'));
    const workoutIdx = headers.findIndex(h => h.includes('workout') || h.includes('main'));

    const rows: Array<{ weekNumber: number; dayName: string; focus: string; mainWorkout: string }> = [];
    
    for (let i = 1; i < Math.min(lines.length, 11); i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/['"]/g, ''));
      if (cols.length >= 4) {
        rows.push({
          weekNumber: parseInt(cols[weekIdx] || '1') || 1,
          dayName: cols[dayIdx] || '',
          focus: cols[focusIdx] || '',
          mainWorkout: cols[workoutIdx] || '',
        });
      }
    }
    return rows;
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".csv")) {
      toast({ title: "Please upload a CSV file", variant: "destructive" });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const csvContent = e.target?.result as string;
      const previewRows = parseCSVForPreview(csvContent);
      setCsvPreview({
        fileName: file.name,
        content: csvContent,
        rows: previewRows,
      });
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const confirmImport = () => {
    if (!csvPreview) return;
    importMutation.mutate({ csvContent: csvPreview.content, fileName: csvPreview.fileName });
    setCsvPreview(null);
  };

  const openDetailDialog = (entry: TimelineEntry) => {
    setDetailEntry(entry);
  };

  const handleSaveFromDetail = (updates: { focus: string; mainWorkout: string; accessory: string | null; notes: string | null; exercises?: any[] }) => {
    if (!detailEntry) return;

    if (detailEntry.workoutLogId) {
      updateWorkoutMutation.mutate({
        workoutId: detailEntry.workoutLogId,
        updates: { ...updates, exercises: updates.exercises },
      });
    } else if (detailEntry.planDayId && updates.exercises && updates.exercises.length > 0) {
      logWorkoutMutation.mutate({
        planDayId: detailEntry.planDayId,
        date: detailEntry.date,
        focus: updates.focus,
        mainWorkout: updates.mainWorkout,
        accessory: updates.accessory || undefined,
        notes: updates.notes || undefined,
        exercises: updates.exercises,
      });
    } else if (detailEntry.planDayId) {
      updateDayMutation.mutate({
        dayId: detailEntry.planDayId,
        updates,
      });
    }
  };

  const handleMarkComplete = (entry: TimelineEntry) => {
    if (!entry.planDayId) return;
    logWorkoutMutation.mutate({
      planDayId: entry.planDayId,
      date: entry.date,
      focus: entry.focus,
      mainWorkout: entry.mainWorkout,
      accessory: entry.accessory || undefined,
      notes: entry.notes || undefined,
    });
  };

  const handleSkip = (entry: TimelineEntry) => {
    setSkipConfirmEntry(entry);
  };

  const confirmSkip = () => {
    if (!skipConfirmEntry?.planDayId) return;
    updateStatusMutation.mutate({ dayId: skipConfirmEntry.planDayId, status: "skipped" });
    setSkipConfirmEntry(null);
  };

  const handleChangeStatus = (entry: TimelineEntry, status: WorkoutStatus) => {
    if (!entry.planDayId) return;
    updateStatusMutation.mutate({ dayId: entry.planDayId, status });
  };

  const handleDelete = (entry: TimelineEntry) => {
    if (entry.workoutLogId && !entry.planDayId) {
      deleteWorkoutMutation.mutate(entry.workoutLogId);
    } else if (entry.planDayId) {
      deletePlanDayMutation.mutate(entry.planDayId);
    }
  };

  const handleCombine = (entry: TimelineEntry) => {
    if (!combiningEntry) {
      setCombiningEntry(entry);
      toast({ title: "Select another workout to combine with", description: "Click on another workout on the same day" });
    } else if (combiningEntry.id === entry.id) {
      setCombiningEntry(null);
      toast({ title: "Combine cancelled" });
    } else if (combiningEntry.date !== entry.date) {
      toast({ title: "Can only combine workouts on the same day", variant: "destructive" });
      setCombiningEntry(null);
    } else {
      setCombineSecondEntry(entry);
      setShowCombineDialog(true);
    }
  };

  const handleConfirmCombine = (combinedWorkout: {
    date: string;
    focus: string;
    mainWorkout: string;
    duration?: number;
    calories?: number;
    notes?: string;
  }) => {
    if (!combiningEntry || !combineSecondEntry) return;
    combineWorkoutsMutation.mutate({
      newWorkout: combinedWorkout,
      entriesToDelete: [combiningEntry, combineSecondEntry],
    });
  };

  const combineWorkoutsMutation = useMutation({
    mutationFn: async ({ newWorkout, entriesToDelete }: { newWorkout: { date: string; focus: string; mainWorkout: string; duration?: number; calories?: number; notes?: string }; entriesToDelete: TimelineEntry[] }) => {
      const response = await apiRequest("POST", "/api/workouts", newWorkout);
      const created = await response.json();
      
      for (const entry of entriesToDelete) {
        if (entry.workoutLogId) {
          await apiRequest("DELETE", `/api/workouts/${entry.workoutLogId}`);
        }
        if (entry.planDayId) {
          await apiRequest("PATCH", `/api/plans/days/${entry.planDayId}/status`, { status: "skipped" });
        }
      }
      
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workouts"] });
      setCombiningEntry(null);
      setCombineSecondEntry(null);
      setShowCombineDialog(false);
      toast({ title: "Workouts combined!" });
    },
    onError: () => {
      setCombiningEntry(null);
      setCombineSecondEntry(null);
      setShowCombineDialog(false);
      toast({ title: "Failed to combine workouts", variant: "destructive" });
    },
  });

  const filteredTimeline = timelineData.filter((entry) => {
    if (filterStatus === "all") return true;
    return entry.status === filterStatus;
  });

  const groupByDate = (entries: TimelineEntry[]) => {
    const groups: Record<string, TimelineEntry[]> = {};
    entries.forEach((entry) => {
      if (!groups[entry.date]) {
        groups[entry.date] = [];
      }
      groups[entry.date].push(entry);
    });
    return Object.entries(groups).sort(([a], [b]) => 
      new Date(b).getTime() - new Date(a).getTime()
    );
  };

  const today = format(new Date(), "yyyy-MM-dd");
  
  const allGroups = groupByDate(filteredTimeline);
  const pastGroups = allGroups.filter(([date]) => date < today);
  const futureGroups = allGroups.filter(([date]) => date >= today).reverse();
  
  const visiblePastGroups = showAllPast ? pastGroups : pastGroups.slice(0, 7);
  const visibleFutureGroups = showAllFuture ? futureGroups : futureGroups.slice(0, 7);
  const hiddenPastCount = pastGroups.length - visiblePastGroups.length;
  const hiddenFutureCount = futureGroups.length - visibleFutureGroups.length;

  return (
    <>
      <OnboardingWizard
        open={showOnboarding}
        onComplete={handleOnboardingComplete}
      />
      <Input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={handleFileUpload}
        data-testid="input-csv-upload-onboarding"
      />
    <div className="flex h-full">
      <div className="flex-1 overflow-auto p-4 md:p-8">
        <div className="max-w-5xl mx-auto space-y-6">
          <TimelineHeader
            onScrollToToday={scrollToToday}
          />

          <TimelineFilters
        plans={plans}
        plansLoading={plansLoading}
        selectedPlanId={selectedPlanId}
        onPlanChange={setSelectedPlanId}
        filterStatus={filterStatus}
        onFilterChange={setFilterStatus}
        onFileUpload={handleFileUpload}
        isImporting={importMutation.isPending}
        onRenamePlan={(planId, name) => renamePlanMutation.mutate({ planId, name })}
        isRenaming={renamePlanMutation.isPending}
      />

      {timelineLoading ? (
        <TimelineSkeleton />
      ) : filteredTimeline.length === 0 ? (
        <Card className="overflow-visible">
          <CardContent className="p-8 md:p-12">
            {filterStatus === "all" && !selectedPlanId && plans.length === 0 ? (
              <div className="text-center space-y-6">
                <div className="flex justify-center gap-3 mb-2">
                  <div className="p-3 rounded-full bg-primary/10">
                    <Target className="h-6 w-6 text-primary" />
                  </div>
                  <div className="p-3 rounded-full bg-primary/10">
                    <Dumbbell className="h-6 w-6 text-primary" />
                  </div>
                  <div className="p-3 rounded-full bg-primary/10">
                    <Zap className="h-6 w-6 text-primary" />
                  </div>
                </div>
                
                <div>
                  <h2 className="text-2xl font-bold mb-2">Welcome to HyroxTracker</h2>
                  <p className="text-muted-foreground max-w-md mx-auto">
                    Your personal training companion for Hyrox preparation. Track workouts, follow structured plans, and get AI-powered coaching.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                  <Button 
                    size="lg" 
                    onClick={() => samplePlanMutation.mutate()}
                    disabled={samplePlanMutation.isPending}
                    data-testid="button-use-sample-plan"
                  >
                    {samplePlanMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4 mr-2" />
                    )}
                    Use 8-Week Hyrox Plan
                  </Button>
                  <div>
                    <Label htmlFor="csv-upload-empty" className="cursor-pointer">
                      <Button size="lg" variant="outline" disabled={importMutation.isPending} data-testid="button-import-plan-empty">
                        {importMutation.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <FileText className="h-4 w-4 mr-2" />
                        )}
                        Import Your Own
                      </Button>
                    </Label>
                    <Input
                      id="csv-upload-empty"
                      type="file"
                      accept=".csv"
                      className="hidden"
                      onChange={handleFileUpload}
                      data-testid="input-csv-upload-empty"
                    />
                  </div>
                </div>

                <div className="flex justify-center pt-2">
                  <Link href="/log">
                    <Button variant="ghost" data-testid="button-log-workout-empty">
                      <Dumbbell className="h-4 w-4 mr-2" />
                      Or just log a workout
                    </Button>
                  </Link>
                </div>

                <p className="text-xs text-muted-foreground pt-2">
                  New to Hyrox? Ask our AI Coach for training recommendations.
                </p>
              </div>
            ) : filterStatus === "all" && selectedPlanId ? (
              <div className="text-center space-y-4">
                <Calendar className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
                <div>
                  <h3 className="font-semibold mb-2">Ready to Start Training</h3>
                  <p className="text-muted-foreground text-sm max-w-md mx-auto">
                    Set a start date for your plan to schedule workouts on your calendar.
                  </p>
                </div>
                <Button
                  onClick={() => setSchedulingPlanId(selectedPlanId)}
                  data-testid="button-set-start-date"
                >
                  <Calendar className="h-4 w-4 mr-2" />
                  Set Start Date
                </Button>
              </div>
            ) : (
              <div className="text-center space-y-4">
                <Calendar className="h-12 w-12 mx-auto text-muted-foreground opacity-50" />
                <div>
                  <h3 className="font-semibold mb-2">No {filterStatus} workouts</h3>
                  <p className="text-muted-foreground text-sm">
                    Try adjusting your filter or complete more workouts to see them here.
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => setFilterStatus("all")}
                  data-testid="button-clear-filter"
                >
                  Show All
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {hiddenPastCount > 0 && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setShowAllPast(true)}
              data-testid="button-show-more-past"
            >
              <ChevronUp className="h-4 w-4 mr-2" />
              Show {hiddenPastCount} more past workout{hiddenPastCount > 1 ? 's' : ''}
            </Button>
          )}
          
          {showAllPast && pastGroups.length > 7 && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => setShowAllPast(false)}
              data-testid="button-hide-past"
            >
              Hide older workouts
            </Button>
          )}

          {[...visiblePastGroups.slice().reverse(), ...visibleFutureGroups].map(([date, entries]) => (
            <TimelineDateGroup
              key={date}
              ref={isToday(parseISO(date)) ? todayRef : undefined}
              date={date}
              entries={entries}
              onMarkComplete={handleMarkComplete}
              onClick={openDetailDialog}
              onCombineSelect={handleCombine}
              isCombining={!!combiningEntry}
              combiningEntryId={combiningEntry?.id || null}
              combiningEntryDate={combiningEntry?.date || null}
            />
          ))}

          {hiddenFutureCount > 0 && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setShowAllFuture(true)}
              data-testid="button-show-more-future"
            >
              <ChevronDown className="h-4 w-4 mr-2" />
              Show {hiddenFutureCount} more upcoming workout{hiddenFutureCount > 1 ? 's' : ''}
            </Button>
          )}
          
          {showAllFuture && futureGroups.length > 7 && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => setShowAllFuture(false)}
              data-testid="button-hide-future"
            >
              Hide later workouts
            </Button>
          )}
          </div>
          )}

          <FloatingActionButton coachPanelOpen={coachOpen} onCoachToggle={() => setCoachOpen(!coachOpen)} />

          <SchedulePlanDialog
            open={!!schedulingPlanId}
            onOpenChange={(open) => !open && setSchedulingPlanId(null)}
            startDate={startDate}
            onStartDateChange={setStartDate}
            onSchedule={() =>
              schedulingPlanId &&
              schedulePlanMutation.mutate({ planId: schedulingPlanId, startDate })
            }
            isPending={schedulePlanMutation.isPending}
          />

          <WorkoutDetailDialog
            entry={detailEntry}
            onClose={() => setDetailEntry(null)}
            onMarkComplete={(entry) => {
              handleMarkComplete(entry);
              setDetailEntry(null);
            }}
            onChangeStatus={(entry, status) => {
              handleChangeStatus(entry, status);
              setDetailEntry(null);
            }}
            onSave={handleSaveFromDetail}
            onDelete={handleDelete}
            onCombine={(entry) => {
              setDetailEntry(null);
              handleCombine(entry);
            }}
            isSaving={updateDayMutation.isPending || updateWorkoutMutation.isPending || logWorkoutMutation.isPending}
            isDeleting={deleteWorkoutMutation.isPending || deletePlanDayMutation.isPending}
          />

          <SkipConfirmDialog
            entry={skipConfirmEntry}
            onOpenChange={() => setSkipConfirmEntry(null)}
            onConfirm={confirmSkip}
          />

          <ImportPreviewDialog
            preview={csvPreview}
            onOpenChange={() => setCsvPreview(null)}
            onConfirm={confirmImport}
            isPending={importMutation.isPending}
          />

          <CombineWorkoutsDialog
            open={showCombineDialog}
            onOpenChange={(open) => {
              setShowCombineDialog(open);
              if (!open) {
                setCombiningEntry(null);
                setCombineSecondEntry(null);
              }
            }}
            entry1={combiningEntry}
            entry2={combineSecondEntry}
            onConfirm={handleConfirmCombine}
            isPending={combineWorkoutsMutation.isPending}
          />
        </div>
      </div>
      
      {coachOpen && (
        <div className="w-80 lg:w-96 flex-shrink-0 hidden md:block">
          <CoachPanel 
            isOpen={coachOpen} 
            onClose={() => setCoachOpen(false)} 
            timeline={timelineData}
            isNewUser={isNewUser}
          />
        </div>
      )}
      
      {coachOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setCoachOpen(false)} />
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-sm bg-background shadow-lg">
            <CoachPanel 
              isOpen={coachOpen} 
              onClose={() => setCoachOpen(false)} 
              timeline={timelineData}
              isNewUser={isNewUser}
            />
          </div>
        </div>
      )}
    </div>
    </>
  );
}
