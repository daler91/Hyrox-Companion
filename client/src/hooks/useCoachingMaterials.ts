import type { CoachingMaterialSummary } from "@shared/schema";
import { useQuery } from "@tanstack/react-query";

import { useToast } from "@/hooks/use-toast";
import { api, QUERY_KEYS, type RagStatus } from "@/lib/api";

import { useApiMutation } from "./useApiMutation";

export type { RagStatus } from "@/lib/api";

/**
 * The athlete's materials as Settings lists them: no text, its length counted
 * by the server. The full list sent every material's text, up to 1.5M
 * characters each, to be parsed on every remount just to show that length.
 * PF4 (CODEBASE_ANALYSIS_2026-10-03)
 */
export function useCoachingMaterials() {
  return useQuery<CoachingMaterialSummary[]>({
    queryKey: QUERY_KEYS.coachingMaterialSummaries,
    queryFn: () => api.coaching.listSummaries(),
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
