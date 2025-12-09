import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileText, Pencil, Trash2, Calendar, Loader2 } from "lucide-react";
import type { TrainingPlan, TrainingPlanWithDays, PlanDay } from "@shared/schema";

export default function Plan() {
  const { toast } = useToast();
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [editingDay, setEditingDay] = useState<PlanDay | null>(null);
  const [editForm, setEditForm] = useState({
    focus: "",
    mainWorkout: "",
    accessory: "",
    notes: "",
  });

  const { data: plans = [], isLoading: plansLoading } = useQuery<TrainingPlan[]>({
    queryKey: ["/api/plans"],
  });

  const { data: selectedPlan, isLoading: planLoading } = useQuery<TrainingPlanWithDays>({
    queryKey: ["/api/plans", selectedPlanId],
    enabled: !!selectedPlanId,
  });

  const importMutation = useMutation({
    mutationFn: async (data: { csvContent: string; fileName: string }) => {
      const response = await apiRequest("POST", "/api/plans/import", data);
      return response.json();
    },
    onSuccess: (plan) => {
      queryClient.invalidateQueries({ queryKey: ["/api/plans"] });
      setSelectedPlanId(plan.id);
      toast({ title: "Plan imported successfully" });
    },
    onError: () => {
      toast({ title: "Failed to import plan", variant: "destructive" });
    },
  });

  const updateDayMutation = useMutation({
    mutationFn: async ({ dayId, updates }: { dayId: string; updates: Partial<PlanDay> }) => {
      const response = await apiRequest("PATCH", `/api/plans/${selectedPlanId}/days/${dayId}`, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plans", selectedPlanId] });
      setEditingDay(null);
      toast({ title: "Day updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update day", variant: "destructive" });
    },
  });

  const deletePlanMutation = useMutation({
    mutationFn: async (planId: string) => {
      await apiRequest("DELETE", `/api/plans/${planId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plans"] });
      setSelectedPlanId(null);
      toast({ title: "Plan deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete plan", variant: "destructive" });
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

  const openEditDialog = (day: PlanDay) => {
    setEditingDay(day);
    setEditForm({
      focus: day.focus,
      mainWorkout: day.mainWorkout,
      accessory: day.accessory || "",
      notes: day.notes || "",
    });
  };

  const handleSaveEdit = () => {
    if (!editingDay) return;
    const updates: Record<string, string | null> = {};
    if (editForm.focus !== editingDay.focus) updates.focus = editForm.focus;
    if (editForm.mainWorkout !== editingDay.mainWorkout) updates.mainWorkout = editForm.mainWorkout;
    if ((editForm.accessory || null) !== editingDay.accessory) updates.accessory = editForm.accessory || null;
    if ((editForm.notes || null) !== editingDay.notes) updates.notes = editForm.notes || null;

    if (Object.keys(updates).length === 0) {
      setEditingDay(null);
      return;
    }

    updateDayMutation.mutate({
      dayId: editingDay.id,
      updates,
    });
  };

  const groupDaysByWeek = (days: PlanDay[]) => {
    const weeks: Record<number, PlanDay[]> = {};
    days.forEach((day) => {
      if (!weeks[day.weekNumber]) {
        weeks[day.weekNumber] = [];
      }
      weeks[day.weekNumber].push(day);
    });
    return weeks;
  };

  const getDayColor = (dayName: string) => {
    const colors: Record<string, string> = {
      Monday: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
      Tuesday: "bg-green-500/10 text-green-600 dark:text-green-400",
      Wednesday: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
      Thursday: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
      Friday: "bg-pink-500/10 text-pink-600 dark:text-pink-400",
      Saturday: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
      Sunday: "bg-red-500/10 text-red-600 dark:text-red-400",
    };
    return colors[dayName] || "bg-muted";
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-page-title">
            Training Plans
          </h1>
          <p className="text-muted-foreground mt-1">
            Import and manage your training programs
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Import Plan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border-2 border-dashed rounded-lg p-6 text-center">
              <FileText className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground mb-3">
                Upload a CSV file with your training plan
              </p>
              <Label htmlFor="csv-upload" className="cursor-pointer">
                <Button
                  variant="outline"
                  className="pointer-events-none"
                  disabled={importMutation.isPending}
                >
                  {importMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    "Choose File"
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

            {plansLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : plans.length > 0 ? (
              <div className="space-y-2">
                <Label>Your Plans</Label>
                <Select
                  value={selectedPlanId || ""}
                  onValueChange={(value) => setSelectedPlanId(value)}
                >
                  <SelectTrigger data-testid="select-plan">
                    <SelectValue placeholder="Select a plan" />
                  </SelectTrigger>
                  <SelectContent>
                    {plans.map((plan) => (
                      <SelectItem key={plan.id} value={plan.id}>
                        {plan.name} ({plan.totalWeeks} weeks)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                No plans imported yet
              </p>
            )}

            {selectedPlanId && (
              <Button
                variant="destructive"
                className="w-full"
                onClick={() => deletePlanMutation.mutate(selectedPlanId)}
                disabled={deletePlanMutation.isPending}
                data-testid="button-delete-plan"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Plan
              </Button>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Weekly Schedule
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedPlanId ? (
              <div className="text-center py-12 text-muted-foreground">
                <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Select or import a plan to view the schedule</p>
              </div>
            ) : planLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : selectedPlan ? (
              <Accordion type="multiple" className="space-y-2" defaultValue={["week-1"]}>
                {Object.entries(groupDaysByWeek(selectedPlan.days)).map(([weekNum, days]) => (
                  <AccordionItem
                    key={weekNum}
                    value={`week-${weekNum}`}
                    className="border rounded-lg px-4"
                    data-testid={`accordion-week-${weekNum}`}
                  >
                    <AccordionTrigger className="py-3">
                      <span className="font-semibold">Week {weekNum}</span>
                      <Badge variant="secondary" className="ml-2">
                        {days.length} days
                      </Badge>
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-3 pb-3">
                        {days.map((day) => (
                          <div
                            key={day.id}
                            className="border rounded-lg p-4 hover-elevate transition-colors"
                            data-testid={`card-plan-day-${day.id}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-2 flex-wrap">
                                  <Badge className={getDayColor(day.dayName)}>
                                    {day.dayName}
                                  </Badge>
                                  <span className="font-medium">{day.focus}</span>
                                </div>
                                <p className="text-sm text-muted-foreground mb-1">
                                  <span className="font-medium">Main:</span> {day.mainWorkout}
                                </p>
                                {day.accessory && (
                                  <p className="text-sm text-muted-foreground mb-1">
                                    <span className="font-medium">Accessory:</span> {day.accessory}
                                  </p>
                                )}
                                {day.notes && (
                                  <p className="text-xs text-muted-foreground italic">
                                    {day.notes}
                                  </p>
                                )}
                              </div>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => openEditDialog(day)}
                                data-testid={`button-edit-day-${day.id}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!editingDay} onOpenChange={() => setEditingDay(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Edit {editingDay?.dayName} - Week {editingDay?.weekNumber}
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
            <Button variant="outline" onClick={() => setEditingDay(null)}>
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
