import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  FileText,
  Pencil,
  Calendar,
  Loader2,
  CheckCircle2,
  Clock,
  XCircle,
  SkipForward,
  MoreVertical,
  Plus,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Link } from "wouter";
import type { TrainingPlan, TimelineEntry, PlanDay, InsertPlanDay } from "@shared/schema";
import { format, parseISO, isToday, isTomorrow, isYesterday, isBefore, isAfter, startOfWeek, addDays, getWeek, startOfDay, endOfDay } from "date-fns";
import {
  TimelineSkeleton,
  TimelineHeader,
  TimelineFilters,
  SuggestionsPanel,
  type FilterStatus,
  type WorkoutSuggestion,
} from "@/components/timeline";

export default function Timeline() {
  const { toast } = useToast();
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [editingEntry, setEditingEntry] = useState<TimelineEntry | null>(null);
  const [schedulingPlanId, setSchedulingPlanId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string>(
    format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd")
  );
  const [editForm, setEditForm] = useState({
    focus: "",
    mainWorkout: "",
    accessory: "",
    notes: "",
  });
  const [skipConfirmEntry, setSkipConfirmEntry] = useState<TimelineEntry | null>(null);
  const [csvPreview, setCsvPreview] = useState<{ fileName: string; content: string; rows: Array<{ weekNumber: number; dayName: string; focus: string; mainWorkout: string }> } | null>(null);
  const [suggestions, setSuggestions] = useState<WorkoutSuggestion[]>([]);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);
  const [showAllPast, setShowAllPast] = useState(false);
  const [showAllFuture, setShowAllFuture] = useState(false);
  
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
      // Clear suggestions when timeline data changes
      setSuggestions([]);
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

  const schedulePlanMutation = useMutation({
    mutationFn: async ({ planId, startDate }: { planId: string; startDate: string }) => {
      const response = await apiRequest("GET", `/api/plans/${planId}`);
      const plan = await response.json();
      
      const dayOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
      const start = parseISO(startDate);
      
      for (const day of plan.days as PlanDay[]) {
        const weekOffset = (day.weekNumber - 1) * 7;
        const dayIndex = dayOrder.indexOf(day.dayName);
        const scheduledDate = addDays(start, weekOffset + (dayIndex >= 0 ? dayIndex : 0));
        
        await apiRequest("PATCH", `/api/plans/days/${day.id}/status`, {
          scheduledDate: format(scheduledDate, "yyyy-MM-dd"),
          status: "planned",
        });
      }
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
      setEditingEntry(null);
      toast({ title: "Entry updated" });
    },
    onError: () => {
      toast({ title: "Failed to update entry", variant: "destructive" });
    },
  });

  const logWorkoutMutation = useMutation({
    mutationFn: async (data: { planDayId: string; date: string; focus: string; mainWorkout: string; accessory?: string; notes?: string }) => {
      const response = await apiRequest("POST", "/api/workouts", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timeline"] });
      toast({ title: "Workout logged!" });
    },
    onError: () => {
      toast({ title: "Failed to log workout", variant: "destructive" });
    },
  });

  const updateWorkoutMutation = useMutation({
    mutationFn: async ({ workoutId, updates }: { workoutId: string; updates: { focus?: string; mainWorkout?: string; accessory?: string | null; notes?: string | null } }) => {
      const response = await apiRequest("PATCH", `/api/workouts/${workoutId}`, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/timeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/workouts"] });
      setEditingEntry(null);
      toast({ title: "Workout updated" });
    },
    onError: () => {
      toast({ title: "Failed to update workout", variant: "destructive" });
    },
  });

  const suggestionsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/timeline/ai-suggestions", {});
      return response.json();
    },
    onSuccess: (data: { suggestions: WorkoutSuggestion[] }) => {
      setSuggestions(data.suggestions || []);
      setDismissedSuggestions(new Set());
      setSuggestionsOpen(true);
      if (data.suggestions?.length === 0) {
        toast({ title: "No suggestions available", description: "Your upcoming workouts look well-balanced!" });
      }
    },
    onError: () => {
      toast({ title: "Failed to get suggestions", variant: "destructive" });
    },
  });

  const handleDismissSuggestion = (workoutId: string) => {
    setDismissedSuggestions(prev => new Set(Array.from(prev).concat(workoutId)));
  };

  const handleApplySuggestion = (suggestion: WorkoutSuggestion) => {
    const entry = timelineData.find(e => e.planDayId === suggestion.workoutId);
    if (entry) {
      setEditingEntry(entry);
      const existingNotes = entry.notes ? `${entry.notes}\n\n` : "";
      setEditForm({
        focus: entry.focus,
        mainWorkout: suggestion.recommendation,
        accessory: entry.accessory || "",
        notes: `${existingNotes}AI suggestion: ${suggestion.rationale}`,
      });
    }
    handleDismissSuggestion(suggestion.workoutId);
  };

  const visibleSuggestions = suggestions.filter(s => !dismissedSuggestions.has(s.workoutId));

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

  const openEditDialog = (entry: TimelineEntry) => {
    setEditingEntry(entry);
    setEditForm({
      focus: entry.focus,
      mainWorkout: entry.mainWorkout,
      accessory: entry.accessory || "",
      notes: entry.notes || "",
    });
  };

  const handleSaveEdit = () => {
    if (!editingEntry) return;
    
    const updates: Record<string, string | null> = {};
    if (editForm.focus !== editingEntry.focus) updates.focus = editForm.focus;
    if (editForm.mainWorkout !== editingEntry.mainWorkout) updates.mainWorkout = editForm.mainWorkout;
    if ((editForm.accessory || null) !== editingEntry.accessory) updates.accessory = editForm.accessory || null;
    if ((editForm.notes || null) !== editingEntry.notes) updates.notes = editForm.notes || null;

    if (Object.keys(updates).length === 0) {
      setEditingEntry(null);
      return;
    }

    if (editingEntry.workoutLogId && !editingEntry.planDayId) {
      updateWorkoutMutation.mutate({
        workoutId: editingEntry.workoutLogId,
        updates,
      });
    } else if (editingEntry.planDayId) {
      updateDayMutation.mutate({
        dayId: editingEntry.planDayId,
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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return (
          <Badge className="bg-green-500/10 text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Completed
          </Badge>
        );
      case "planned":
        return (
          <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400">
            <Clock className="h-3 w-3 mr-1" />
            Planned
          </Badge>
        );
      case "missed":
        return (
          <Badge className="bg-red-500/10 text-red-600 dark:text-red-400">
            <XCircle className="h-3 w-3 mr-1" />
            Missed
          </Badge>
        );
      case "skipped":
        return (
          <Badge className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
            <SkipForward className="h-3 w-3 mr-1" />
            Skipped
          </Badge>
        );
      default:
        return null;
    }
  };

  const getDateLabel = (dateObj: Date) => {
    if (isToday(dateObj)) return "Today";
    if (isTomorrow(dateObj)) return "Tomorrow";
    if (isYesterday(dateObj)) return "Yesterday";
    return format(dateObj, "EEEE, MMM d");
  };

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
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <TimelineHeader
        onAICoach={() => suggestionsMutation.mutate()}
        onScrollToToday={scrollToToday}
        isLoading={suggestionsMutation.isPending}
      />

      <SuggestionsPanel
        suggestions={visibleSuggestions}
        isOpen={suggestionsOpen}
        onOpenChange={setSuggestionsOpen}
        onDismiss={handleDismissSuggestion}
        onApply={handleApplySuggestion}
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
      />

      {timelineLoading ? (
        <TimelineSkeleton />
      ) : filteredTimeline.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Calendar className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h3 className="font-semibold mb-2">
              {filterStatus === "all"
                ? selectedPlanId 
                  ? "Ready to Start Training"
                  : "Your Training Journey Begins Here"
                : `No ${filterStatus} workouts`}
            </h3>
            <p className="text-muted-foreground text-sm max-w-md mx-auto">
              {filterStatus === "all"
                ? selectedPlanId 
                  ? "Set a start date for your plan to schedule workouts on your calendar. You'll see all your planned sessions here."
                  : "Import a CSV training plan to get structured workouts, or log individual sessions as you complete them."
                : `Try adjusting your filter or complete more workouts to see them here.`}
            </p>
            {filterStatus === "all" && selectedPlanId && (
              <Button
                className="mt-4"
                onClick={() => setSchedulingPlanId(selectedPlanId)}
                data-testid="button-set-start-date"
              >
                <Calendar className="h-4 w-4 mr-2" />
                Set Start Date
              </Button>
            )}
            {filterStatus === "all" && !selectedPlanId && plans.length === 0 && (
              <>
                <Label htmlFor="csv-upload-empty" className="cursor-pointer">
                  <Button className="mt-4" disabled={importMutation.isPending}>
                    {importMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <FileText className="h-4 w-4 mr-2" />
                    )}
                    Import Training Plan
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
              </>
            )}
            {filterStatus !== "all" && (
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => setFilterStatus("all")}
                data-testid="button-clear-filter"
              >
                Show All
              </Button>
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

          {[...visiblePastGroups.slice().reverse(), ...visibleFutureGroups].map(([date, entries]) => {
            const dateObj = parseISO(date);
            const isTodayDate = isToday(dateObj);
            const isPast = isBefore(dateObj, new Date()) && !isTodayDate;

            return (
              <div key={date} className="relative" ref={isTodayDate ? todayRef : undefined}>
                {isTodayDate && (
                  <div className="absolute -left-4 top-0 bottom-0 w-1 bg-primary rounded-full" />
                )}
                <div
                  className={`flex items-center gap-3 mb-3 ${
                    isTodayDate ? "text-primary font-semibold" : ""
                  }`}
                >
                  <div
                    className={`h-3 w-3 rounded-full ${
                      isTodayDate
                        ? "bg-primary"
                        : isPast
                        ? "bg-muted-foreground/30"
                        : "bg-muted-foreground/50"
                    }`}
                  />
                  <span className={isTodayDate ? "" : "text-muted-foreground"}>
                    {getDateLabel(dateObj)}
                  </span>
                  {entries[0]?.weekNumber && (
                    <Badge variant="outline" className="ml-auto">
                      Week {entries[0].weekNumber}
                    </Badge>
                  )}
                </div>

                <div className="space-y-2 ml-6">
                  {entries.map((entry) => (
                    <Card
                      key={entry.id}
                      className={`${
                        entry.status === "completed"
                          ? "border-green-500/20 bg-green-500/5"
                          : entry.status === "missed"
                          ? "border-red-500/20 bg-red-500/5"
                          : entry.status === "skipped"
                          ? "border-yellow-500/20 bg-yellow-500/5"
                          : ""
                      }`}
                      data-testid={`card-timeline-entry-${entry.id}`}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2 flex-wrap">
                              {getStatusBadge(entry.status)}
                              {entry.dayName && (
                                <Badge variant="secondary">{entry.dayName}</Badge>
                              )}
                              <span className="font-medium">{entry.focus}</span>
                            </div>
                            <p className="text-sm text-muted-foreground mb-1">
                              {entry.mainWorkout}
                            </p>
                            {entry.accessory && (
                              <p className="text-sm text-muted-foreground/70 mb-1">
                                {entry.accessory}
                              </p>
                            )}
                            {entry.notes && (
                              <p className="text-xs text-muted-foreground italic mt-2">
                                {entry.notes}
                              </p>
                            )}
                            {entry.duration && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Duration: {entry.duration} min
                                {entry.rpe && ` | RPE: ${entry.rpe}`}
                              </p>
                            )}
                          </div>

                          {entry.status === "planned" && entry.planDayId && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  data-testid={`button-entry-menu-${entry.id}`}
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => handleMarkComplete(entry)}
                                  data-testid={`button-complete-${entry.id}`}
                                >
                                  <CheckCircle2 className="h-4 w-4 mr-2" />
                                  Mark Complete
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => openEditDialog(entry)}
                                  data-testid={`button-edit-${entry.id}`}
                                >
                                  <Pencil className="h-4 w-4 mr-2" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleSkip(entry)}
                                  data-testid={`button-skip-${entry.id}`}
                                >
                                  <SkipForward className="h-4 w-4 mr-2" />
                                  Skip
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}

                          {entry.status === "missed" && entry.planDayId && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  data-testid={`button-entry-menu-${entry.id}`}
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => handleMarkComplete(entry)}
                                  data-testid={`button-complete-${entry.id}`}
                                >
                                  <CheckCircle2 className="h-4 w-4 mr-2" />
                                  Mark Complete
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => openEditDialog(entry)}
                                  data-testid={`button-edit-${entry.id}`}
                                >
                                  <Pencil className="h-4 w-4 mr-2" />
                                  Edit
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}

                          {(entry.status === "completed" || entry.status === "skipped") && entry.planDayId && (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openEditDialog(entry)}
                              data-testid={`button-edit-${entry.id}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}

                          {entry.workoutLogId && !entry.planDayId && (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openEditDialog(entry)}
                              data-testid={`button-edit-${entry.id}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}

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

      <Dialog open={!!schedulingPlanId} onOpenChange={() => setSchedulingPlanId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule Your Training Plan</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Choose when your training plan should start. Week 1 will begin on this date.
            </p>
            <div>
              <Label htmlFor="start-date">Start Date (Monday)</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                data-testid="input-start-date"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSchedulingPlanId(null)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                schedulingPlanId &&
                schedulePlanMutation.mutate({ planId: schedulingPlanId, startDate })
              }
              disabled={schedulePlanMutation.isPending}
              data-testid="button-schedule-plan"
            >
              {schedulePlanMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Scheduling...
                </>
              ) : (
                "Schedule Plan"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingEntry} onOpenChange={() => setEditingEntry(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Edit {editingEntry?.dayName} - Week {editingEntry?.weekNumber}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-focus">Focus</Label>
              <Input
                id="edit-focus"
                value={editForm.focus}
                onChange={(e) => setEditForm({ ...editForm, focus: e.target.value })}
                data-testid="input-edit-focus"
              />
            </div>
            <div>
              <Label htmlFor="edit-main">Main Workout</Label>
              <Textarea
                id="edit-main"
                value={editForm.mainWorkout}
                onChange={(e) => setEditForm({ ...editForm, mainWorkout: e.target.value })}
                rows={3}
                data-testid="input-edit-main"
              />
            </div>
            <div>
              <Label htmlFor="edit-accessory">Accessory/Engine Work</Label>
              <Textarea
                id="edit-accessory"
                value={editForm.accessory}
                onChange={(e) => setEditForm({ ...editForm, accessory: e.target.value })}
                rows={2}
                data-testid="input-edit-accessory"
              />
            </div>
            <div>
              <Label htmlFor="edit-notes">Notes</Label>
              <Input
                id="edit-notes"
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                data-testid="input-edit-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingEntry(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={updateDayMutation.isPending || updateWorkoutMutation.isPending}
              data-testid="button-save-edit"
            >
              {updateDayMutation.isPending || updateWorkoutMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!skipConfirmEntry} onOpenChange={(open) => !open && setSkipConfirmEntry(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Skip this workout?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark "{skipConfirmEntry?.focus}" as skipped. You can still go back and complete it later if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-skip">Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmSkip}
              data-testid="button-confirm-skip"
            >
              Skip Workout
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!csvPreview} onOpenChange={(open) => !open && setCsvPreview(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Import Preview: {csvPreview?.fileName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Preview of first {csvPreview?.rows.length} workouts from your training plan:
            </p>
            <div className="border rounded-md overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-2 font-medium">Week</th>
                      <th className="text-left p-2 font-medium">Day</th>
                      <th className="text-left p-2 font-medium">Focus</th>
                      <th className="text-left p-2 font-medium">Main Workout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {csvPreview?.rows.map((row, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="p-2">{row.weekNumber}</td>
                        <td className="p-2">{row.dayName}</td>
                        <td className="p-2">{row.focus}</td>
                        <td className="p-2 max-w-[200px] truncate" title={row.mainWorkout}>
                          {row.mainWorkout}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {csvPreview && csvPreview.content.split('\n').length > 11 && (
              <p className="text-xs text-muted-foreground text-center">
                ... and {csvPreview.content.split('\n').length - 11} more workouts
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCsvPreview(null)}>
              Cancel
            </Button>
            <Button
              onClick={confirmImport}
              disabled={importMutation.isPending}
              data-testid="button-confirm-import"
            >
              {importMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Importing...
                </>
              ) : (
                "Confirm Import"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Floating Action Button - rendered via portal to escape sidebar container */}
      {createPortal(
        <Link href="/log">
          <Button
            size="icon"
            className="!fixed !bottom-6 !right-6 h-14 w-14 rounded-full shadow-lg"
            style={{ zIndex: 9999 }}
            data-testid="button-log-workout-fab"
          >
            <Plus className="h-6 w-6" />
          </Button>
        </Link>,
        document.body
      )}
    </div>
  );
}
