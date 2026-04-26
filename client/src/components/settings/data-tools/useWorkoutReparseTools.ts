import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { useToast } from "@/hooks/use-toast";
import { api, QUERY_KEYS } from "@/lib/api";
import { apiRequest, queryClient } from "@/lib/queryClient";

export interface ParseResults {
  readonly success: number;
  readonly failed: number;
}

export function useWorkoutReparseTools() {
  const { toast } = useToast();
  const [unstructuredCount, setUnstructuredCount] = useState<number | null>(null);
  const [parseResults, setParseResults] = useState<ParseResults | null>(null);

  const findUnstructuredMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("GET", "/api/v1/workouts/unstructured");
      return response.json() as Promise<Array<{ id: string }>>;
    },
    onSuccess: (data: Array<{ id: string }>) => {
      setUnstructuredCount(data.length);
      toast({
        title: "Search Complete",
        description: `Found ${data.length} workouts without structured exercise data.`,
      });
    },
    onError: () => {
      toast({
        title: "Search Failed",
        description: "Failed to find unstructured workouts.",
        variant: "destructive",
      });
    },
  });

  const batchReparseMutation = useMutation({
    mutationFn: () => api.workouts.batchReparse(),
    onSuccess: (data) => {
      setParseResults({ success: data.parsed, failed: data.failed });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timeline }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.workouts }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.personalRecords }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.exerciseAnalytics }).catch(() => {});
      toast({
        title: "Parsing Complete",
        description: `Parsed ${data.parsed} workouts successfully. ${data.failed} could not be parsed.`,
      });
    },
    onError: () => {
      toast({
        title: "Parsing Failed",
        description: "Failed to parse workouts with AI.",
        variant: "destructive",
      });
    },
  });

  const reset = () => {
    setUnstructuredCount(null);
    setParseResults(null);
  };

  return {
    unstructuredCount,
    parseResults,
    findUnstructuredMutation,
    batchReparseMutation,
    reset,
  };
}
