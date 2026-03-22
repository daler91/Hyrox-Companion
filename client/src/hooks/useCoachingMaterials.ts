import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { api, QUERY_KEYS, type RagStatus } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import type { CoachingMaterial } from "@shared/schema";

export type { RagStatus } from "@/lib/api";

export function useCoachingMaterials() {
  return useQuery<CoachingMaterial[]>({
    queryKey: QUERY_KEYS.coachingMaterials,
    queryFn: () => api.coaching.list(),
  });
}

export function useCreateCoachingMaterial() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: (data: { title: string; content: string; type: "principles" | "document" }) =>
      api.coaching.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.coachingMaterials });
      toast({ title: "Coaching material added" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add coaching material", description: error.message, variant: "destructive" });
    },
  });
}

export function useUpdateCoachingMaterial() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; title?: string; content?: string; type?: "principles" | "document" }) =>
      api.coaching.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.coachingMaterials });
      toast({ title: "Coaching material updated" });
    },
    onError: () => {
      toast({ title: "Failed to update coaching material", variant: "destructive" });
    },
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

  return useMutation({
    mutationFn: () => api.coaching.reEmbed(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.ragStatus });
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
    onError: (error: Error) => {
      toast({ title: "Failed to re-embed", description: error.message, variant: "destructive" });
    },
  });
}

export function useDeleteCoachingMaterial() {
  const { toast } = useToast();

  return useMutation({
    mutationFn: (id: string) => api.coaching.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.coachingMaterials });
      toast({ title: "Coaching material removed" });
    },
    onError: () => {
      toast({ title: "Failed to remove coaching material", variant: "destructive" });
    },
  });
}
