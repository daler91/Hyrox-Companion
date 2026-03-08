import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { TrainingPlan, TimelineEntry, PlanDay, WorkoutStatus } from "@shared/schema";
import { format, startOfWeek } from "date-fns";
import type { FilterStatus, CsvPreviewData } from "@/components/timeline";

export function useTimelineState() {
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToToday = useCallback(() => {
    todayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const { data: plans = [], isLoading: plansLoading } = useQuery<TrainingPlan[]>({
    queryKey: ["/api/plans"],
  });

  const { data: personalRecords } = useQuery<Record<string, any>>({
    queryKey: ["/api/personal-records"],
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

  useEffect(() => {
    if (isNewUser && !onboardingTriggered && !localStorage.getItem("hyrox-onboarding-complete")) {
      setOnboardingTriggered(true);
      setShowOnboarding(true);
    }
  }, [isNewUser, onboardingTriggered]);

  useEffect(() => {
    if (!showOnboarding && onboardingTriggered && !hasAutoOpenedCoach) {
      setHasAutoOpenedCoach(true);
      setTimeout(() => {
        const isCurrentlyMobile = window.innerWidth < 768;
        if (!isCurrentlyMobile) {
          setCoachOpen(true);
        }
      }, 500);
    }
  }, [showOnboarding, onboardingTriggered, hasAutoOpenedCoach]);

  const handleOnboardingComplete = useCallback((choice: "sample" | "import" | "skip") => {
    setShowOnboarding(false);
    if (choice === "import" && fileInputRef.current) {
      setTimeout(() => {
        fileInputRef.current?.click();
      }, 100);
    } else if (choice === "sample") {
      queryClient.invalidateQueries({ queryKey: ["/api/plans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/timeline"] });
    }
  }, []);

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

  const parseCSVForPreview = useCallback((csvContent: string) => {
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
  }, []);

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
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
  }, [parseCSVForPreview, toast]);

  const confirmImport = useCallback(() => {
    if (!csvPreview) return;
    importMutation.mutate({ csvContent: csvPreview.content, fileName: csvPreview.fileName });
    setCsvPreview(null);
  }, [csvPreview, importMutation]);

  const openDetailDialog = useCallback((entry: TimelineEntry) => {
    setDetailEntry(entry);
  }, []);

  const handleSaveFromDetail = useCallback((updates: { focus: string; mainWorkout: string; accessory: string | null; notes: string | null; exercises?: any[] }) => {
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
  }, [detailEntry, updateWorkoutMutation, logWorkoutMutation, updateDayMutation]);

  const handleMarkComplete = useCallback((entry: TimelineEntry) => {
    if (!entry.planDayId) return;
    logWorkoutMutation.mutate({
      planDayId: entry.planDayId,
      date: entry.date,
      focus: entry.focus,
      mainWorkout: entry.mainWorkout,
      accessory: entry.accessory || undefined,
      notes: entry.notes || undefined,
    });
  }, [logWorkoutMutation]);

  const handleSkip = useCallback((entry: TimelineEntry) => {
    setSkipConfirmEntry(entry);
  }, []);

  const confirmSkip = useCallback(() => {
    if (!skipConfirmEntry?.planDayId) return;
    updateStatusMutation.mutate({ dayId: skipConfirmEntry.planDayId, status: "skipped" });
    setSkipConfirmEntry(null);
  }, [skipConfirmEntry, updateStatusMutation]);

  const handleChangeStatus = useCallback((entry: TimelineEntry, status: WorkoutStatus) => {
    if (!entry.planDayId) return;
    updateStatusMutation.mutate({ dayId: entry.planDayId, status });
  }, [updateStatusMutation]);

  const handleDelete = useCallback((entry: TimelineEntry) => {
    if (entry.workoutLogId && !entry.planDayId) {
      deleteWorkoutMutation.mutate(entry.workoutLogId);
    } else if (entry.planDayId) {
      deletePlanDayMutation.mutate(entry.planDayId);
    }
  }, [deleteWorkoutMutation, deletePlanDayMutation]);

  const handleCombine = useCallback((entry: TimelineEntry) => {
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
  }, [combiningEntry, toast]);

  const handleConfirmCombine = useCallback((combinedWorkout: {
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
  }, [combiningEntry, combineSecondEntry, combineWorkoutsMutation]);

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

  return {
    plans,
    plansLoading,
    personalRecords,
    timelineData,
    timelineLoading,
    isNewUser,

    selectedPlanId,
    setSelectedPlanId,
    filterStatus,
    setFilterStatus,
    detailEntry,
    setDetailEntry,
    schedulingPlanId,
    setSchedulingPlanId,
    startDate,
    setStartDate,
    skipConfirmEntry,
    setSkipConfirmEntry,
    csvPreview,
    setCsvPreview,
    showAllPast,
    setShowAllPast,
    showAllFuture,
    setShowAllFuture,
    combiningEntry,
    setCombiningEntry,
    combineSecondEntry,
    setCombineSecondEntry,
    showCombineDialog,
    setShowCombineDialog,
    coachOpen,
    setCoachOpen,
    showOnboarding,
    setShowOnboarding,

    todayRef,
    fileInputRef,
    scrollToToday,

    handleOnboardingComplete,
    handleFileUpload,
    confirmImport,
    openDetailDialog,
    handleSaveFromDetail,
    handleMarkComplete,
    handleSkip,
    confirmSkip,
    handleChangeStatus,
    handleDelete,
    handleCombine,
    handleConfirmCombine,

    importMutation,
    samplePlanMutation,
    renamePlanMutation,
    schedulePlanMutation,
    updateDayMutation,
    logWorkoutMutation,
    updateWorkoutMutation,
    deleteWorkoutMutation,
    deletePlanDayMutation,
    combineWorkoutsMutation,

    filteredTimeline,
    pastGroups,
    futureGroups,
    visiblePastGroups,
    visibleFutureGroups,
    hiddenPastCount,
    hiddenFutureCount,
  };
}
