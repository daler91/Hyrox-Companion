import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface CoachingMaterial {
  id: string;
  userId: string;
  title: string;
  content: string;
  type: "principles" | "document";
  createdAt: string;
  updatedAt: string;
}

const QUERY_KEY = ["/api/v1/coaching-materials"];

function useCoachingMutationOptions(successMessage: string, errorMessage: string) {
  const { toast } = useToast();

  return {
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({ title: successMessage });
    },
    onError: (error: Error) => {
      toast({
        title: errorMessage,
        description: error.message,
        variant: "destructive",
      });
    },
  };
}

export function useCoachingMaterials() {
  return useQuery<CoachingMaterial[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/v1/coaching-materials");
      return response.json();
    },
  });
}

export function useCreateCoachingMaterial() {
  const mutationOptions = useCoachingMutationOptions(
    "Coaching material added",
    "Failed to add coaching material"
  );

  return useMutation({
    mutationFn: async (data: { title: string; content: string; type: "principles" | "document" }) => {
      const response = await apiRequest("POST", "/api/v1/coaching-materials", data);
      return response.json();
    },
    ...mutationOptions,
  });
}

export function useUpdateCoachingMaterial() {
  const mutationOptions = useCoachingMutationOptions(
    "Coaching material updated",
    "Failed to update coaching material"
  );

  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string; title?: string; content?: string; type?: "principles" | "document" }) => {
      const response = await apiRequest("PATCH", `/api/v1/coaching-materials/${id}`, data);
      return response.json();
    },
    ...mutationOptions,
  });
}

export function useDeleteCoachingMaterial() {
  const mutationOptions = useCoachingMutationOptions(
    "Coaching material removed",
    "Failed to remove coaching material"
  );

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/v1/coaching-materials/${id}`);
      return response.json();
    },
    ...mutationOptions,
  });
}
