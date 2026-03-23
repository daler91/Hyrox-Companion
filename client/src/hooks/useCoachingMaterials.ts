import { useQuery } from "@tanstack/react-query";
import { api, QUERY_KEYS, type RagStatus } from "@/lib/api";
import { useApiMutation } from "./useApiMutation";
import type { CoachingMaterial } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

export type { RagStatus } from "@/lib/api";

export function useCoachingMaterials() {
  return useQuery<CoachingMaterial[]>({
    queryKey: QUERY_KEYS.coachingMaterials,
    queryFn: () => api.coaching.list(),
  });
}

export function useCreateCoachingMaterial() {
  return useApiMutation({
    mutationFn: (data: { title: string; content: string; type: "principles" | "document" }) =>
      api.coaching.create(data),
    invalidateQueries: [QUERY_KEYS.coachingMaterials],
    successToast: "Coaching material added",
    errorToast: (error: Error) => ({
      title: "Failed to add coaching material",
      description: error.message
    }),
  });
}

export function useUpdateCoachingMaterial() {
  return useApiMutation({
    mutationFn: ({ id, ...data }: { id: string; title?: string; content?: string; type?: "principles" | "document" }) =>
      api.coaching.update(id, data),
    invalidateQueries: [QUERY_KEYS.coachingMaterials],
    successToast: "Coaching material updated",
    errorToast: "Failed to update coaching material",
  });
}

export function useRagStatus() {
  return useQuery<RagStatus>({
    queryKey: QUERY_KEYS.ragStatus,
    queryFn: () => api.coaching.getRagStatus(),
  });
}

export function useReEmbed() {
  const { toast } = useToast();

  return useApiMutation({
    mutationFn: () => api.coaching.reEmbed(),
    invalidateQueries: [QUERY_KEYS.ragStatus],
    onSuccess: (data) => {
      if (data.errors?.length > 0) {
        toast({
          title: `Embedded ${data.materialsProcessed} materials with ${data.errors.length} error(s)`,
          description: data.errors[0],
          variant: "destructive",
        });
      } else {
        toast({ title: `Successfully embedded ${data.materialsProcessed} material(s)` });
      }
    },
    errorToast: (error: Error) => ({
      title: "Failed to re-embed",
      description: error.message
    }),
  });
}

export function useDeleteCoachingMaterial() {
  return useApiMutation({
    mutationFn: (id: string) => api.coaching.delete(id),
    invalidateQueries: [QUERY_KEYS.coachingMaterials],
    successToast: "Coaching material removed",
    errorToast: "Failed to remove coaching material",
  });
}
