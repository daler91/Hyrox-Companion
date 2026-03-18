import { useState, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format, startOfWeek } from "date-fns";
import type { CsvPreviewData } from "@/components/timeline";

interface UsePlanImportOptions {
  onPlanScheduled?: (planId: string) => void;
}

export function usePlanImport({ onPlanScheduled }: UsePlanImportOptions = {}) {
  const { toast } = useToast();
  const [csvPreview, setCsvPreview] = useState<CsvPreviewData | null>(null);
  const [schedulingPlanId, setSchedulingPlanId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string>(
    format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd")
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importMutation = useMutation({
    mutationFn: async (data: { csvContent: string; fileName: string }) => {
      const response = await apiRequest("POST", "/api/v1/plans/import", data);
      return response.json();
    },
    onSuccess: (plan) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/plans"] });
      setSchedulingPlanId(plan.id);
      toast({ title: "Plan imported! Now set a start date." });
    },
    onError: () => {
      toast({ title: "Failed to import plan", variant: "destructive" });
    },
  });

  const samplePlanMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/v1/plans/sample", {});
      return response.json();
    },
    onSuccess: (plan) => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/plans"] });
      setSchedulingPlanId(plan.id);
      toast({ title: "Sample plan created! Now set a start date." });
    },
    onError: () => {
      toast({ title: "Failed to create sample plan", variant: "destructive" });
    },
  });

  const renamePlanMutation = useMutation({
    mutationFn: async ({ planId, name }: { planId: string; name: string }) => {
      await apiRequest("PATCH", `/api/v1/plans/${planId}`, { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/plans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/timeline"] });
      toast({ title: "Plan renamed" });
    },
    onError: () => {
      toast({ title: "Failed to rename plan", variant: "destructive" });
    },
  });

  const updatePlanGoalMutation = useMutation({
    mutationFn: async ({ planId, goal }: { planId: string; goal: string | null }) => {
      const response = await apiRequest("PATCH", `/api/v1/plans/${planId}/goal`, { goal });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/v1/plans"] });
      toast({ title: "Goal saved" });
    },
    onError: () => {
      toast({ title: "Failed to save goal", variant: "destructive" });
    },
  });

  const schedulePlanMutation = useMutation({
    mutationFn: async ({ planId, startDate: sd }: { planId: string; startDate: string }) => {
      await apiRequest("POST", `/api/v1/plans/${planId}/schedule`, { startDate: sd });
    },
    onSuccess: () => {
      const planIdToSelect = schedulingPlanId;
      queryClient.invalidateQueries({ queryKey: ["/api/v1/timeline", planIdToSelect] });
      queryClient.invalidateQueries({ queryKey: ["/api/v1/plans"] });
      if (planIdToSelect) {
        onPlanScheduled?.(planIdToSelect);
      }
      setSchedulingPlanId(null);
      toast({ title: "Training plan scheduled!" });
    },
    onError: () => {
      toast({ title: "Failed to schedule plan", variant: "destructive" });
    },
  });

  const parseCSVForPreview = useCallback((csvContent: string) => {
    const lines = csvContent.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replaceAll(/['"]/g, ""));
    const weekIdx = headers.findIndex(h => h.includes('week'));
    const dayIdx = headers.findIndex(h => h.includes('day'));
    const focusIdx = headers.findIndex(h => h.includes('focus') || h.includes('type'));
    const workoutIdx = headers.findIndex(h => h.includes('workout') || h.includes('main'));

    const rows: Array<{ weekNumber: number; dayName: string; focus: string; mainWorkout: string }> = [];

    for (let i = 1; i < Math.min(lines.length, 11); i++) {
      const cols = lines[i].split(',').map(c => c.trim().replaceAll(/['"]/g, ""));
      if (cols.length >= 4) {
        rows.push({
          weekNumber: Number.parseInt(cols[weekIdx] || '1', 10) || 1,
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

    file.text().then((csvContent) => {
      const previewRows = parseCSVForPreview(csvContent);
      setCsvPreview({
        fileName: file.name,
        content: csvContent,
        rows: previewRows,
      });
      event.target.value = "";
    }).catch(() => {
      toast({ title: "Failed to read file", variant: "destructive" });
    });
  }, [parseCSVForPreview, toast]);

  const confirmImport = useCallback(() => {
    if (!csvPreview) return;
    importMutation.mutate({ csvContent: csvPreview.content, fileName: csvPreview.fileName });
    setCsvPreview(null);
  }, [csvPreview, importMutation]);

  return {
    csvPreview,
    setCsvPreview,
    schedulingPlanId,
    setSchedulingPlanId,
    startDate,
    setStartDate,
    fileInputRef,
    handleFileUpload,
    confirmImport,
    importMutation,
    samplePlanMutation,
    renamePlanMutation,
    schedulePlanMutation,
    updatePlanGoalMutation,
  };
}
