import type {
  InsertTimelineAnnotation,
  TimelineAnnotation,
  TimelineAnnotationType,
} from "@shared/schema";
import { useMutation, useQuery } from "@tanstack/react-query";

import { useToast } from "@/hooks/use-toast";
import { api, QUERY_KEYS } from "@/lib/api";

import { handleCreateAnnotationSuccess, handleDeleteAnnotationSuccess, handleMutationError } from "./timelineAnnotationMutations.utils";

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
    onSuccess: () =>
      handleCreateAnnotationSuccess({
        toast,
        type,
        onCreated,
      }),
    onError: () => handleMutationError(toast, "Couldn't add annotation"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.timelineAnnotations.delete(id),
    onSuccess: () => handleDeleteAnnotationSuccess(toast),
    onError: () => handleMutationError(toast, "Couldn't delete annotation"),
  });

  return {
    createMutation,
    deleteMutation,
  };
}
