import type {
  InsertTimelineAnnotation,
  TimelineAnnotation,
  TimelineAnnotationType,
} from "@shared/schema";
import { useMutation, useQuery } from "@tanstack/react-query";

import { useToast } from "@/hooks/use-toast";
import { api, QUERY_KEYS } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

import { TYPE_LABELS } from "../annotation-style";

export function useTimelineAnnotations(open: boolean) {
  return useQuery<TimelineAnnotation[]>({
    queryKey: QUERY_KEYS.timelineAnnotations,
    queryFn: () => api.timelineAnnotations.list(),
    enabled: open,
  });
}

export function useTimelineAnnotationMutations({
  type,
  onCreated,
}: {
  readonly type: TimelineAnnotationType;
  readonly onCreated: () => void;
}) {
  const { toast } = useToast();

  const createMutation = useMutation({
    mutationFn: (data: InsertTimelineAnnotation) => api.timelineAnnotations.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timelineAnnotations }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.trainingOverview }).catch(() => {});
      toast({
        title: "Annotation added",
        description: `${TYPE_LABELS[type]} saved to your timeline.`,
      });
      onCreated();
    },
    onError: () =>
      toast({
        title: "Couldn't add annotation",
        description: "Please try again.",
        variant: "destructive",
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.timelineAnnotations.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.timelineAnnotations }).catch(() => {});
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.trainingOverview }).catch(() => {});
      toast({ title: "Annotation removed" });
    },
    onError: () =>
      toast({
        title: "Couldn't delete annotation",
        description: "Please try again.",
        variant: "destructive",
      }),
  });

  return {
    createMutation,
    deleteMutation,
  };
}
