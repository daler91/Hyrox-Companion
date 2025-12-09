import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
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
  Filter,
} from "lucide-react";
import type { TrainingPlan, TimelineEntry, PlanDay, InsertPlanDay } from "@shared/schema";
import { format, parseISO, isToday, isBefore, isAfter, startOfWeek, addDays } from "date-fns";

type FilterStatus = "all" | "completed" | "planned" | "missed" | "skipped";

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

  const { data: plans = [], isLoading: plansLoading } = useQuery<TrainingPlan[]>({
    queryKey: ["/api/plans"],
  });

  const { data: timelineData = [], isLoading: timelineLoading } = useQuery<TimelineEntry[]>({
    queryKey: ["/api/timeline", selectedPlanId],
    queryFn: async () => {
      const res = await fetch(`/api/timeline?planId=${selectedPlanId}`);
      if (!res.ok) throw new Error("Failed to fetch timeline");
      return res.json();
    },
    enabled: !!selectedPlanId,
  });

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
      importMutation.mutate({ csvContent, fileName: file.name });
    };
    reader.readAsText(file);
    event.target.value = "";
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
    if (!editingEntry || !editingEntry.planDayId) return;
    const updates: Record<string, string | null> = {};
    if (editForm.focus !== editingEntry.focus) updates.focus = editForm.focus;
    if (editForm.mainWorkout !== editingEntry.mainWorkout) updates.mainWorkout = editForm.mainWorkout;
    if ((editForm.accessory || null) !== editingEntry.accessory) updates.accessory = editForm.accessory || null;
    if ((editForm.notes || null) !== editingEntry.notes) updates.notes = editForm.notes || null;

    if (Object.keys(updates).length === 0) {
      setEditingEntry(null);
      return;
    }

    updateDayMutation.mutate({
      dayId: editingEntry.planDayId,
      updates,
    });
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
    if (!entry.planDayId) return;
    updateStatusMutation.mutate({ dayId: entry.planDayId, status: "skipped" });
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

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">
            Training Timeline
          </h1>
          <p className="text-muted-foreground mt-1">
            Your complete training journey - past, present, and future
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
            <div className="flex-1">
              <Label htmlFor="plan-select" className="text-sm text-muted-foreground mb-2 block">
                Active Training Plan
              </Label>
              {plansLoading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">Loading plans...</span>
                </div>
              ) : plans.length > 0 ? (
                <Select
                  value={selectedPlanId || ""}
                  onValueChange={(value) => setSelectedPlanId(value)}
                >
                  <SelectTrigger id="plan-select" data-testid="select-plan">
                    <SelectValue placeholder="Select a training plan" />
                  </SelectTrigger>
                  <SelectContent>
                    {plans.map((plan) => (
                      <SelectItem key={plan.id} value={plan.id}>
                        {plan.name} ({plan.totalWeeks} weeks)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground">No plans yet. Import one below.</p>
              )}
            </div>

            <div className="flex gap-2 flex-wrap">
              <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as FilterStatus)}>
                <SelectTrigger className="w-36" data-testid="select-filter">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="planned">Planned</SelectItem>
                  <SelectItem value="missed">Missed</SelectItem>
                  <SelectItem value="skipped">Skipped</SelectItem>
                </SelectContent>
              </Select>

              <Label htmlFor="csv-upload" className="cursor-pointer">
                <Button
                  variant="outline"
                  className="pointer-events-none"
                  disabled={importMutation.isPending}
                >
                  {importMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Import CSV
                    </>
                  )}
                </Button>
              </Label>
              <Input
                id="csv-upload"
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileUpload}
                data-testid="input-csv-upload"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {!selectedPlanId ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Calendar className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h3 className="text-xl font-semibold mb-2">Get Started</h3>
            <p className="text-muted-foreground mb-4">
              Select an existing plan or import a new CSV to view your timeline
            </p>
            <Label htmlFor="csv-upload-main" className="cursor-pointer">
              <Button disabled={importMutation.isPending}>
                {importMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4 mr-2" />
                )}
                Import Training Plan
              </Button>
            </Label>
            <Input
              id="csv-upload-main"
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileUpload}
              data-testid="input-csv-upload-main"
            />
          </CardContent>
        </Card>
      ) : timelineLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : filteredTimeline.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">
              {filterStatus === "all"
                ? "No scheduled workouts yet. Set a start date for your plan."
                : `No ${filterStatus} workouts found.`}
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
          {groupByDate(filteredTimeline).map(([date, entries]) => {
            const dateObj = parseISO(date);
            const isTodayDate = isToday(dateObj);
            const isPast = isBefore(dateObj, new Date()) && !isTodayDate;

            return (
              <div key={date} className="relative">
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
                    {isTodayDate ? "Today" : format(dateObj, "EEEE, MMM d")}
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
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
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
              disabled={updateDayMutation.isPending}
              data-testid="button-save-edit"
            >
              {updateDayMutation.isPending ? (
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
    </div>
  );
}
